import express from 'express'
import bodyParser from 'body-parser'
import Slouch from 'couch-slouch'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import proxy from 'express-http-proxy'

// @TODO: set environment variables
const TOP_SECRET_JWT_TOKEN = 'SUPER TOP SECRET PASSWORD CHANGE THIS'

const app = express();
const logger = function(req, res, next) {
    console.log(`${req.method}: ${req.url}` );
    next(); // Passing the request to the next handler in the stack.
    console.log(res.status())
}

app.use(bodyParser.json());
app.use(logger)

const USERS_DB = 'users'
const slouch = new Slouch('http://equesteo:equesteo@localhost:15984');
slouch.db.create(USERS_DB)

const USERS_DESIGN_DOC = '_design/users'
slouch.db.create(USERS_DB).then(() => {
  slouch.doc.createOrUpdate(USERS_DB, {
    _id: USERS_DESIGN_DOC,
    views: {
      by_email: {
        map: function (doc) { emit(doc.email, doc.password); }.toString()
      }
    }
  })
})

app.get('/', (req, res) => {
  res.send('Hello World 2!');
});

// @TODO this endpoint needs authentication
app.use('/couchproxy', proxy('http://equesteo:equesteo@localhost:15984', {
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    proxyReqOpts.headers['Authorization'] = 'Basic ' + Buffer.from(`${'equesteo'}:${"equesteo"}`).toString('base64')
    return proxyReqOpts
  },
}))

app.post('/users', async (req, res) => {
  const email = req.body.email
  const password = req.body.password
  const result = await slouch.db.viewArray(USERS_DB, USERS_DESIGN_DOC, 'by_email', { key: `"${email}"`})
  const found = result.rows
  if (found.length) {
    return res.status(400).json({'error': 'User already exists'})
  }
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
  const newUser = await slouch.doc.create(USERS_DB, {email, password: hashed})
  const token = jwt.sign({ email }, TOP_SECRET_JWT_TOKEN);
  return res.json({
    id: newUser.id,
    token
  })
})

app.post('/users/login', async (req, res) => {
  const email = req.body.email
  const password = req.body.password
  const result = await slouch.db.viewArray(USERS_DB, USERS_DESIGN_DOC, 'by_email', { key: `"${email}"`})
  const found = result.rows
  if (!password || found.length < 1 || !bcrypt.compareSync(password, found[0].value)) {
    return res.status(401).json({'error': 'Wrong username/password'})
  } else if (found.length === 1) {
    const token = jwt.sign({ email }, TOP_SECRET_JWT_TOKEN);
    return res.json({
      id: found[0].id,
      token
    })
  }
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});

//@TODO: get this shit deployed!