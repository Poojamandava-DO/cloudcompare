const express = require('express');
const router = express.Router();
const products = require('../data/products.json');

router.post('/', (req, res) => {
  const { workload, tier } = req.body;

  if (!workload || !tier) {
    return res.status(400).json({
      error: 'Missing required fields: workload and tier'
    });
  }

  const workloadData = products.workloads.find(w => w.type === workload);

  if (!workloadData) {
    return res.status(404).json({
      error: `Workload type '${workload}' not found`,
      available_workloads: products.workloads.map(w => w.type)
    });
  }

  const tierData = workloadData.tiers[tier];

  if (!tierData) {
    return res.status(404).json({
      error: `Tier '${tier}' not found for workload '${workload}'`,
      available_tiers: Object.keys(workloadData.tiers)
    });
  }

  const doTotal = tierData.digitalocean.products.reduce((sum, p) => sum + p.cost, 0);
  const awsTotal = tierData.aws.products.reduce((sum, p) => sum + p.cost, 0);
  const savings = Math.round(((awsTotal - doTotal) / awsTotal) * 100);
  const monthlySavings = awsTotal - doTotal;

  res.status(200).json({
    workload: workloadData.label,
    tier: tier,
    users: tierData.users,
    digitalocean: {
      products: tierData.digitalocean.products,
      total_monthly_cost: `$${doTotal}`
    },
    aws: {
      products: tierData.aws.products,
      total_monthly_cost: `$${awsTotal}`
    },
    savings: {
      percentage: `${savings}%`,
      monthly_savings: `$${monthlySavings}`,
      annual_savings: `$${monthlySavings * 12}`
    },
    recommendation: `DigitalOcean saves you $${monthlySavings}/month ($${monthlySavings * 12}/year) compared to AWS for this workload.`
  });
});

module.exports = router;
