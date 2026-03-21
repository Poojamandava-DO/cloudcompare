const express = require('express');
const router = express.Router();

let requestCount = 0;

const trackRequests = (req, res, next) => {
  requestCount++;
  next();
};

router.use(trackRequests);

router.get('/', (req, res) => {
  const memoryUsage = process.memoryUsage();
  res.status(200).json({
    uptime_seconds: Math.floor(process.uptime()),
    total_requests: requestCount,
    memory: {
      used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024)
    },
    cpu_arch: process.arch,
    node_version: process.version,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
