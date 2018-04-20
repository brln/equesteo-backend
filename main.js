import express from 'express'
const app = express();

app.get('/', (req, res) => {
  res.send('Hello World 2!');
});

app.listen(process.env.PORT || 3000, function () {
  console.log('Example app listening on port 3000!');
});