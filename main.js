import aws from 'aws-sdk'
import bcrypt from 'bcryptjs'
import bodyParser from 'body-parser'
import express from 'express'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import multerS3 from 'multer-s3'
import path from 'path'
import Slouch from 'couch-slouch'


import { authenticator } from './auth'

import { postRide } from './controllers/gpxUploader'
import { couchProxy } from './controllers/couchProxy'

import { createUsersDesignDoc, USERS_DB, USERS_DESIGN_DOC } from "./design_docs/users"
import { createHorsesDesignDoc } from "./design_docs/horses"
import { createRidesDesignDoc } from './design_docs/rides'

import {
  configGet,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  TOP_SECRET_JWT_TOKEN
} from "./config"
import { currentTime, pwResetCode } from './helpers'
import EmailerService from './services/emailer'

const app = express()
const s3 = new aws.S3()

aws.config.update({
  secretAccessKey: configGet(AWS_SECRET_ACCESS_KEY),
  accessKeyId: configGet(AWS_ACCESS_KEY_ID),
  region: 'us-east-1'
});

const logger = (req, res, next) => {
    next(); // Passing the request to the next handler in the stack.
    console.log(`${currentTime()} - ${req.method}: ${req.url}` )
}

app.use(logger)
app.use(express.static('static'))
app.use("/gpxUploader", express.static(path.join(__dirname, 'frontend', 'build')))

const INQUIRIES_DB = 'inquiries'
const slouch = new Slouch(
  `http://${configGet(COUCH_USERNAME)}:${configGet(COUCH_PASSWORD)}@${configGet(COUCH_HOST)}`
);
slouch.db.create(INQUIRIES_DB)
createUsersDesignDoc(slouch)
createHorsesDesignDoc(slouch)
createRidesDesignDoc(slouch)

// Create endpoints
postRide(app)
couchProxy(app)

app.post('/inquiries', bodyParser.json(), async (req, res) => {
  const email = req.body.email
  const type = req.body.type
  await slouch.doc.create(INQUIRIES_DB, {
    email, type
  })
  return res.json({})
})

app.post('/users/updateDBNotification', authenticator, bodyParser.json(), async (req, res) => {
  const userID = res.locals.userID
  const db = req.body.db
  const pusherS = new PusherService()
  const result = await slouch.db.viewArray(
    USERS_DB,
    USERS_DESIGN_DOC,
    'followers',
    { key: `"${userID}"`}
  )
  for (let followerResult of result.rows) {
    const followerID = followerResult.id
    const channelStatus = await pusherS.channelStatus(followerID)
    const occupied = JSON.parse(channelStatus.body).occupied
    if (occupied) {
      pusherS.trigger(followerID, db)
    }
  }
  return res.json({})
})

app.post('/users', bodyParser.json(), async (req, res) => {
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
    photosByID: {},
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


app.post('/users/login', bodyParser.json(), async (req, res) => {
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

app.post('/users/getPWCode', bodyParser.json(), async (req, res) => {
  const email = req.body.email
  const result = await slouch.db.viewArray(
    USERS_DB,
    USERS_DESIGN_DOC,
    'by_email',
    { key: `"${email}"`, include_docs: true}
  )
  const found = result.rows
  if (found.length === 1) {
    const code = pwResetCode()
    const noWhitespace = code.replace(/\s+/g, '')
    const doc = found[0].doc
    const newDoc = Object.assign({}, doc, { pwResetCode: noWhitespace })
    await slouch.doc.update(USERS_DB, newDoc)

    const emailer = new EmailerService()
    emailer.sendCode(email, code)
  }
  return res.json({})
})


app.post('/users/exchangePWCode', bodyParser.json(), async (req, res) => {
  const email = req.body.email
  const code = req.body.code.replace(/\s+/g, '')
  const result = await slouch.db.viewArray(
    USERS_DB,
    USERS_DESIGN_DOC,
    'by_email',
    { key: `"${email}"`, include_docs: true}
  )
  const found = result.rows
  const doc = found[0].doc
  if (found.length < 1 || code !== doc.pwResetCode) {
    return res.status(401).json({'error': 'Wrong email/code.'})
  } else if (found.length === 1) {
    const token = jwt.sign(
      {
        id: found[0].id,
        email,
      },
      configGet(TOP_SECRET_JWT_TOKEN)
    );

    const newDoc = Object.assign({}, doc, { pwResetCode: null })
    await slouch.doc.update(USERS_DB, newDoc)
    return res.json({
      id: found[0].id,
      following: found[0].doc.following,
      token
    })
  }
})

app.post('/users/changePW', authenticator, bodyParser.json(), async (req, res) => {
  const email = res.locals.userEmail
  const password = req.body.password
  const hashed = bcrypt.hashSync(password, bcrypt.genSaltSync(10));

  const result = await slouch.db.viewArray(
    USERS_DB,
    USERS_DESIGN_DOC,
    'by_email',
    { key: `"${email}"`, include_docs: true}
  )
  const found = result.rows
  const doc = found[0].doc
  const newDoc = Object.assign({}, doc, { password: hashed })
  await slouch.doc.update(USERS_DB, newDoc)
  return res.json({})
})

const userMeta = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'equesteo-profile-photos',
    key: function (req, file, cb) {
      cb(null, file.originalname)
    }
  })
});
app.post('/users/profilePhoto', authenticator, userMeta.single('file'), (req, res, next) => {
  return res.json({})
})


const horseMeta = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'equesteo-horse-photos-2',
    key: function (req, file, cb) {
      cb(null, file.originalname)
    }
  })
});
app.post('/users/horsePhoto', authenticator, horseMeta.single('file'), (req, res, next) => {
  console.log('horse photo uploaded')
  return res.json({})
})

const rideMeta = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'equesteo-ride-photos',
    key: function (req, file, cb) {
      cb(null, file.originalname)
    }
  })
});
app.post('/users/ridePhoto', authenticator, rideMeta.single('file'), (req, res, next) => {
  console.log('ride photo uploaded')
  return res.json({})
})

app.get('/users/search', authenticator, async (req, res) => {
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

