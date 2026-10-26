import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { paymentStatusPresentation } from '../js/payments/mercadopago-checkout.js';

// Execute the real return controller with browser/cart ports. The status is the
// server's response, while query parameters deliberately claim the opposite.
const source = fs.readFileSync(new URL('../js/payments/mercadopago-return.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm, '');
const P = '22222222-2222-4222-8222-222222222222';
async function returned({cart = [], combos = [], recovery = {}, items = [], status = 'completed', payment = 'completed', concurrent = false} = {}) {
  let cleared = 0;
  const state = {cart:structuredClone(cart),combos:structuredClone(combos)};
  const events = new Map();
  const elements = new Map();
  const decrement = (rows,key,id) => {
    const row = rows.find(r=>r[key]===id);
    if (row) row.quantity -= 1;
    return rows.filter(r=>r.quantity>0);
  };
  const responses=[];
  const checkout={ok:true,checkout:{status,payment_status:payment,items}};
  const repository = {
    getMercadoPagoCheckoutRecovery:()=>({checkoutSessionId:'33333333-3333-4333-8333-333333333333',...recovery}),
    getMercadoPagoCheckoutStatus:()=>concurrent?new Promise(resolve=>responses.push(resolve)):Promise.resolve(checkout),
    clearMercadoPagoCheckoutRecovery:()=>{cleared+=1;},
  };
  const context = vm.createContext({
    getOrderRepository:()=>repository,paymentStatusPresentation,
    clearCart:()=>{state.cart=[];state.combos=[];},
    decrementCartItem:id=>{state.cart=decrement(state.cart,'productId',id);},
    decrementComboItem:id=>{state.combos=decrement(state.combos,'comboId',id);},
    getCartItems:()=>state.cart.map(r=>({...r,product:{id:r.productId}})),
    navigator:{onLine:true},location:{search:'?status=approved&payment_id=manipulated'},
    document:{querySelector:selector=>{
      if(!elements.has(selector)) elements.set(selector,{dataset:{}});
      return elements.get(selector);
    }},
    window:{addEventListener:(name,fn)=>events.set(name,fn),setTimeout:()=>1,clearTimeout:()=>{}},
  });
  vm.runInContext(source,context);
  if(concurrent){events.get('online')();for(const resolve of responses)resolve(checkout);}
  await new Promise(resolve=>setImmediate(resolve));
  return {state,cleared,elements};
}
test('return preserves a new unpaid combo when purchased loose products exactly match', async()=>{
  const r=await returned({cart:[{productId:P,quantity:1}],combos:[{comboId:'new-unpaid',quantity:1}],
    recovery:{items:[{productId:P,quantity:1}],combos:[]},items:[{product_id:P,quantity:1}]});
  assert.deepEqual(r.state.cart,[]);
  assert.deepEqual(r.state.combos,[{comboId:'new-unpaid',quantity:1}]);
});

test('overlapping status responses remove paid quantities once',async()=>{
  const r=await returned({cart:[{productId:P,quantity:3}],recovery:{items:[{productId:P,quantity:1}],combos:[]},
    items:[{product_id:P,quantity:1}],concurrent:true});
  assert.deepEqual(r.state.cart,[{productId:P,quantity:2}]);
  assert.equal(r.cleared,1);
});
test('return of a paid combo preserves loose components added after checkout', async()=>{
  const r=await returned({cart:[{productId:P,quantity:2}],combos:[{comboId:'paid-combo',quantity:1}],
    recovery:{items:[],combos:[{comboId:'paid-combo',quantity:1}]},items:[{product_id:P,quantity:6}]});
  assert.deepEqual(r.state.cart,[{productId:P,quantity:2}]);
  assert.deepEqual(r.state.combos,[]);
});
test('mixed purchase subtracts only original loose quantity, not expanded combo units', async()=>{
  const r=await returned({cart:[{productId:P,quantity:3}],combos:[{comboId:'paid-combo',quantity:2}],
    recovery:{items:[{productId:P,quantity:1}],combos:[{comboId:'paid-combo',quantity:1}]},items:[{product_id:P,quantity:7}]});
  assert.deepEqual(r.state.cart,[{productId:P,quantity:2}]);
  assert.deepEqual(r.state.combos,[{comboId:'paid-combo',quantity:1}]);
});
test('return keeps rejected checkout cart despite manipulated approved URL', async()=>{
  const r=await returned({cart:[{productId:P,quantity:1}],combos:[{comboId:'unpaid-combo',quantity:1}],
    status:'payment_pending',payment:'rejected',items:[{product_id:P,quantity:1}]});
  assert.equal(r.cleared,0);
  assert.equal(r.state.cart[0].quantity,1);
  assert.equal(r.state.combos[0].quantity,1);
  assert.equal(r.elements.get('[data-payment-return-title]').textContent,'Pago rechazado');
});
