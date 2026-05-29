# Real product catalog plan

This document describes how to move from mock products to real La Taba products.

## Goal

Replace demo catalog data with real catalog data that the business can maintain without rewriting the app later.

## What we need per product

Each product should include:

- `name`: commercial name used by the client
- `category`: main catalog category
- `description`: short text that helps the client decide
- `price`: final price shown in the app
- `unit`: how it is sold, such as `kg`, `unit`, `pack`, or `combo`
- `stock`: available quantity or stock indicator
- `photo`: image that can be shown in catalog and product detail
- `featured`: whether it should appear as highlighted
- `offer`: whether it has a promo label
- `available`: whether it can be ordered now
- `prepMinutes`: estimated preparation time
- `internalNotes`: staff-only notes for preparation or selling rules

## Proposed data model for products

The initial product record can stay simple and practical:

```json
{
  "id": "p-asado-especial",
  "name": "Asado especial",
  "category": "carnes",
  "description": "Corte seleccionado para parrilla.",
  "price": 9800,
  "unit": "kg",
  "stock": 12,
  "photo": "asado-especial.jpg",
  "featured": true,
  "offer": false,
  "available": true,
  "prepMinutes": 20,
  "internalNotes": "Cortar en piezas medianas"
}
```

## Suggested migration path

1. Collect the real product list with Walter.
2. Normalize names, categories and units.
3. Assign one photo per product where it matters.
4. Decide which products are featured and which are offers.
5. Add stock rules that are simple enough to maintain.
6. Export the first real catalog into CSV or spreadsheet format.
7. Move the real catalog into the app without changing the flow.

## Practical rules

- Keep names short and familiar.
- Avoid duplicate categories.
- Use one unit style per product type.
- Do not overcomplicate stock on day one.
- Use internal notes only for the team.

## What to avoid

- Long descriptions that do not help sell.
- Too many product variants in the first pass.
- Photos with inconsistent quality.
- Mixing public copy with internal-only notes.
- Starting with complex inventory logic before the basics work.

## Recommended first catalog size

Start with a focused catalog:

- 8 to 12 key meats and cuts
- 3 to 5 milanesa or ready-to-cook items
- 3 to 5 combos
- 2 to 4 drinks or add-ons
- 3 to 5 promotional items if they are really used

That is enough for a first real version without making maintenance hard.
