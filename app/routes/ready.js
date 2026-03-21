const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    message: 'CloudCompare is ready to serve traffic'
  });
});

module.exports = router;
