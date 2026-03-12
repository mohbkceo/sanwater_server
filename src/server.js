const mongoose = require('mongoose');
const app = require('./app');
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI;



mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB is connected');
  app.listen(PORT, "0.0.0.0", () => {
      console.log(`Port: ${PORT}`);
    }); 
}).catch((err) => {
  console.error('MongoDB connection error:', err);
});
  