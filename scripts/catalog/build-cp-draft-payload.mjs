import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../..');
const catalog=JSON.parse(readFileSync(`${root}/docs/catalog/catalog-source-2026-09.json`,'utf8')).products;
const subcategoryBySku={
  'fernet-branca-750ml':'fernet',
  'branca-menta-750ml':'menta',
  'cepita-naranja-1000ml':'naranja',
  'cepita-durazno-1000ml':'durazno',
  'trapiche-cabernet-sauvignon-750ml':'cabernet-sauvignon',
  'trapiche-red-blend-750ml':'red-blend',
  'santa-julia-chenin-dulce-750ml':'blanco-dulce',
  'stella-artois-rubia-473ml':'rubia',
  'schneider-rubia-710ml':'rubia',
  'lays-clasicas-134g':'papas-fritas',
  'lays-clasicas-40g':'papas-fritas',
  'doritos-queso-129g':'nachos',
  'pehuamar-palitos-salados-90g':'palitos',
  'mani-king-salado-sin-piel-100g':'mani',
};
const alcoholic=new Set(['Cervezas','Fernet','Aperitivos','Vinos','Espumantes','Destilados']);
function capacity(size) {
  const match=/^(\d+(?:,\d+)?) (ml|L|g|kg)$/.exec(size);
  if(!match) throw new Error(`Unrecognized size: ${size}`);
  const number=Number(match[1].replace(',','.'));
  const value=match[2]==='L'||match[2]==='kg'?number*1000:number;
  if(!Number.isSafeInteger(value)||value<=0) throw new Error(`Invalid capacity: ${size}`);
  return {capacity_value:value,capacity_unit:match[2]==='L'?'ml':match[2]==='kg'?'g':match[2]};
}
const rows=catalog.map(product=>({
  sku:product.sku,brand:product.brand,name:product.product,variant:product.variant,
  ...capacity(product.size),packaging_type:product.packaging,category:product.category,
  subcategory:product.subcategory||subcategoryBySku[product.sku]||'',
  is_alcoholic:alcoholic.has(product.category),
}));
if(rows.length!==46||rows.some(r=>!r.subcategory||!r.brand||!r.name||!r.variant||!r.packaging_type)) throw new Error('Incomplete catalog');
const key=r=>[r.brand,r.name,r.variant,r.capacity_value,r.capacity_unit].join('|').normalize('NFKD').toLowerCase();
if(new Set(rows.map(r=>r.sku)).size!==46||new Set(rows.map(key)).size!==46) throw new Error('Duplicate identities');
const json=JSON.stringify(rows);
const sha256=createHash('sha256').update(json).digest('hex');
const outIndex=process.argv.indexOf('--out');
if(outIndex>=0){
  const file=process.argv[outIndex+1];
  if(!file||file.startsWith('--'))throw new Error('--out requires a file path');
  writeFileSync(path.resolve(file),JSON.stringify(rows,null,2)+'\n');
}
console.log(JSON.stringify({rows:rows.length,sha256,alcoholic:rows.filter(r=>r.is_alcoholic).length,categories:[...new Set(rows.map(r=>r.category))]}));
