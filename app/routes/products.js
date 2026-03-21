const express = require('express');
const router = express.Router();
const products = require('../data/products.json');

router.get('/', (req, res) => {
  res.status(200).json({
    total_workloads: products.workloads.length,
    workloads: products.workloads.map(w => ({
      type: w.type,
      label: w.label,
      available_tiers: Object.keys(w.tiers)
    }))
  });
});

module.exports = router;
