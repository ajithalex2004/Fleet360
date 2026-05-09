/**
 * One-time Stripe bootstrap.
 *
 *   STRIPE_SECRET_KEY=sk_live_… npx tsx scripts/stripe-bootstrap.ts
 *
 * Creates Products + monthly Prices for STANDARD / PROFESSIONAL / ENTERPRISE
 * in USD and AED, then prints the env-var lines to copy into your deployment.
 *
 * Idempotent: looks up existing products by metadata.tenant_plan and reuses
 * them. Re-running prints the same env vars.
 *
 * Edit the AMOUNTS below for your real pricing before running.
 */

import Stripe from 'stripe';

interface PlanDef {
  code: 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
  name: string;
  description: string;
  /** Monthly price in smallest currency unit (cents / fils). */
  amounts: { usd: number; aed: number };
}

const PLANS: PlanDef[] = [
  { code: 'STANDARD',     name: 'XL AI Smart Mobility — Standard',
    description: 'Core fleet + bookings for small operators',
    amounts: { usd: 24900,  aed: 91500  } }, // $249 / AED 915
  { code: 'PROFESSIONAL', name: 'XL AI Smart Mobility — Professional',
    description: 'All modules + analytics + SSO',
    amounts: { usd: 79900,  aed: 293000 } }, // $799 / AED 2,930
  { code: 'ENTERPRISE',   name: 'XL AI Smart Mobility — Enterprise',
    description: 'Unlimited usage + premium support',
    amounts: { usd: 249900, aed: 917000 } }, // $2,499 / AED 9,170
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { console.error('Set STRIPE_SECRET_KEY first.'); process.exit(1); }
  const stripe = new Stripe(key);

  const out: string[] = [];

  for (const plan of PLANS) {
    // Find or create the product, keyed off metadata.tenant_plan.
    const existing = await stripe.products.search({ query: `metadata['tenant_plan']:'${plan.code}' AND active:'true'` });
    let product = existing.data[0];
    if (!product) {
      product = await stripe.products.create({
        name: plan.name, description: plan.description,
        metadata: { tenant_plan: plan.code },
      });
      console.log(`✔ created product ${plan.code}: ${product.id}`);
    } else {
      console.log(`= product ${plan.code} exists: ${product.id}`);
    }

    for (const currency of ['usd', 'aed'] as const) {
      const amount = plan.amounts[currency];
      const matches = await stripe.prices.search({
        query: `product:'${product.id}' AND currency:'${currency}' AND active:'true' AND metadata['tenant_plan']:'${plan.code}'`,
      });
      let price = matches.data.find(p => p.unit_amount === amount && p.recurring?.interval === 'month');
      if (!price) {
        price = await stripe.prices.create({
          product: product.id,
          currency,
          unit_amount: amount,
          recurring: { interval: 'month' },
          metadata: { tenant_plan: plan.code },
        });
        console.log(`  ✔ created price ${plan.code}/${currency.toUpperCase()}: ${price.id}`);
      } else {
        console.log(`  = price ${plan.code}/${currency.toUpperCase()} exists: ${price.id}`);
      }
      out.push(`STRIPE_PRICE_${plan.code}_${currency.toUpperCase()}=${price.id}`);
    }
  }

  console.log('\n--- Add these to your deployment env ---');
  for (const line of out) console.log(line);
}

main().catch(err => { console.error(err); process.exit(1); });
