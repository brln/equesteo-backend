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
import { currentTime } from './helpers'

const app = express();
const logger = (req, res, next) => {
    next(); // Passing the request to the next handler in the stack.
    console.log(`${currentTime()} - ${req.method}: ${req.url}` );
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

app.use(logger)
app.use(express.static('static'))

const USERS_DB = 'users'
const HORSES_DB = 'horses'
const RIDES_DB = 'rides'

const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);
slouch.db.create(HORSES_DB)

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

const RIDES_DESIGN_DOC = '_design/rides'
slouch.db.create(RIDES_DB).then(() => {
  slouch.doc.createOrUpdate(RIDES_DB, {
    _id: RIDES_DESIGN_DOC,
    filters: {
      byUserIDs: function (doc, req) {
        var userIDs = req.query.userIDs.split(',');
        return userIDs.indexOf(doc.userID) >= 0;
      }.toString()
    }
  })
})

const HORSES_DESIGN_DOC = '_design/horses'
slouch.db.create(HORSES_DB).then(() => {
  slouch.doc.createOrUpdate(HORSES_DB, {
    _id: HORSES_DESIGN_DOC,
    filters: {
      byUserIDs: function (doc, req) {
        var userIDs = req.query.userIDs.split(',');
        return userIDs.indexOf(doc.userID) >= 0;
      }.toString()
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
  proxyErrorHandler: function(err, res, next) {
    console.log(err)
    next(err);
  }
}))

app.post('/users', bodyParser.json())
app.post('/users', async (req, res) => {
  const email = req.body.email
  const password = req.body.password
  const result = await slouch.db.viewArray(USERS_DB, USERS_DESIGN_DOC, 'by_email', { key: `"${email}"`})
  const found = result.rows
  if (found.length) {
    return res.status(400).json({'error': 'User already exists'})
  }
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
  const newUser = await slouch.doc.create(USERS_DB, {
    email,
    following: [],
    password: hashed,
    firstName: null,
    lastName: null,
    aboutMe: null,
    profilePhotoID: null,
  })
  const token = jwt.sign(
    { id: newUser.id, email },
    configGet(TOP_SECRET_JWT_TOKEN)
  );
  return res.json({
    id: newUser.id,
    token
  })
})


app.post('/users/login', bodyParser.json())
app.post('/users/login', async (req, res) => {
  const email = req.body.email
  const password = req.body.password
  const result = await slouch.db.viewArray(
    USERS_DB,
    USERS_DESIGN_DOC,
    'by_email',
    { key: `"${email}"`, include_docs: true}
  )
  const found = result.rows
  if (!password || found.length < 1 || !bcrypt.compareSync(password, found[0].value)) {
    return res.status(401).json({'error': 'Wrong username/password'})
  } else if (found.length === 1) {
    const token = jwt.sign(
      {
        id: found[0].id,
        email,
      },
      configGet(TOP_SECRET_JWT_TOKEN)
    );
    return res.json({
      id: found[0].id,
      following: found[0].doc.following,
      token
    })
  }
})

app.get('/users/search', async (req, res) => {
  const query = req.query.q
  const result = await slouch.db.viewArray(USERS_DB, USERS_DESIGN_DOC, 'by_email')
  const emails = result.rows.map((r) => r.key)
  const matches = emails.filter((e) => e.includes(query))
  const ids = result.rows.filter((r) => matches.indexOf(r.key) >= 0).map((r) => r.id)
  const full_records = await slouch.doc.allArray(USERS_DB, {keys: JSON.stringify(ids), include_docs: true})
  return res.json(full_records.rows.map((r) => {
    return {
      _id: r.doc._id,
      email: r.doc.email,
      following: r.doc.following,
      firstName: r.doc.firstName,
      lastName: r.doc.lastName,
      aboutMe: r.doc.aboutMe,
      profilePhotoID: r.doc.profilePhotoID,
    }
  }))
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});
