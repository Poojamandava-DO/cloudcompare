const express = require('express');
const path = require('path');

const healthRouter = require('./routes/health');
const readyRouter = require('./routes/ready');
const metricsRouter = require('./routes/metrics');
const productsRouter = require('./routes/products');
const compareRouter = require('./routes/compare');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/health', healthRouter);
app.use('/ready', readyRouter);
app.use('/metrics', metricsRouter);
app.use('/products', productsRouter);
app.use('/compare', compareRouter);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CloudCompare running on port ${PORT}`);
});

module.exports = app;
