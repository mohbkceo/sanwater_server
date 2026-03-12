const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
dotenv.config(); 
const app = express();
const { logTrafic } = require('./config/data_controle');
const corsOptions = require('./config/corsHandler');





app.set('trust proxy', true)
app.use(cookieParser())
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.use(logTrafic);
app.use('/products', require('./routes/product.routes'));
app.use('/content', require('./routes/content.routes'))
app.get('/', (_, res) => {
    res.send('built with love, by www.logixdz.com developers Coperation!');
})
app.use(require('./middlewares/notFound'))

module.exports = app;
