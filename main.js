import path from 'path'
import express from 'express'
import bodyParser from 'body-parser'
import Slouch from 'couch-slouch'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import proxy from 'express-http-proxy'

import {
  configGet,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  TOP_SECRET_JWT_TOKEN
} from "./config"

const app = express();
const logger = (req, res, next) => {
    next(); // Passing the request to the next handler in the stack.
    console.log(`${res.statusCode}: ${req.method}: ${req.url}` );
}

const authenticator = (req, res, next) => {
  const authHeader = req.headers.authorization
  if (authHeader) {
    const token = req.headers.authorization.split('Bearer: ')[1]
    let decoded = undefined
    try {
      decoded = jwt.verify(token, configGet(TOP_SECRET_JWT_TOKEN))
    } catch (e) {}
    if (!token || !decoded) {
      return res.status(401).json({error: 'Invalid Authorization header'})
    }
    const email = decoded.email
    const userID = decoded.id
    res.locals.userID = userID
    res.locals.userEmail = email
    next()
  } else {
    return res.status(401).json({error: 'Authorization header required'})
  }
}

app.use(bodyParser.json());
app.use(logger)
app.use(express.static('static'))

const USERS_DB = 'users'
const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);
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

app.use('/couchproxy', authenticator)
app.use('/couchproxy', proxy(`http://${configGet(COUCH_HOST)}`, {
  proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
    const authString = 'Basic ' +
      Buffer.from(
        `${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}`
      ).toString('base64')
    proxyReqOpts.headers['Authorization'] = authString
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
  const token = jwt.sign(
    { id: newUser.id, email },
    configGet(TOP_SECRET_JWT_TOKEN)
  );
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
    console.log(configGet(TOP_SECRET_JWT_TOKEN))
    const token = jwt.sign(
      { id: found[0].id, email },
      configGet(TOP_SECRET_JWT_TOKEN)
    );
    return res.json({
      id: found[0].id,
      token
    })
  }
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});
