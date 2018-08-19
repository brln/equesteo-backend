import aws from 'aws-sdk'
import bcrypt from 'bcryptjs'
import bodyParser from 'body-parser'
import express from 'express'
import gcm from 'node-gcm'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import multerS3 from 'multer-s3'
import path from 'path'
import Slouch from 'couch-slouch'
import elasticsearch from 'elasticsearch'


import { authenticator } from './auth'
import {
  configGet,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  ELASTICSEARCH_HOST,
  GCM_API_KEY,
  TOP_SECRET_JWT_TOKEN
} from "./config"
import { currentTime, pwResetCode, unixTimeNow } from './helpers'
import { postRide } from './controllers/gpxUploader'
import { couchProxy } from './controllers/couchProxy'
import { createUsersDesignDoc, USERS_DB, USERS_DESIGN_DOC } from "./design_docs/users"
import { createHorsesDesignDoc } from "./design_docs/horses"
import { createRidesDesignDoc } from './design_docs/rides'
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

startChangesFeedForElastic()
startChangesFeedForPush()

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const sender = new gcm.Sender(configGet(GCM_API_KEY));

function startChangesFeedForPush() {
  let iterator = slouch.db.changes('rides', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
    since: 'now'
  })

  iterator.each(async (item) => {
    if (item.doc && item.doc.type === 'ride' && item.doc._rev.split('-')[0] === '1' && item.doc.isPublic === true) {
      console.log(item.doc)
      const userID = item.doc.userID
      if (!userID) throw Error('wut why not')
      const followers = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'followers',
        { key: `"${userID}"`, include_docs: true }
      )
      console.log(followers)

      const user = await slouch.doc.get(USERS_DB, item.doc.userID)
      const followerFCMTokens = []
      followers.rows.reduce((r, e) => {
        if (e.doc.fcmToken) r.push(e.doc.fcmToken)
        return r
      }, followerFCMTokens)

      const message = new gcm.Message({
        data: {
          rideID: item.doc._id,
          userID: item.doc.userID,
          userName: `${user.firstName} ${user.lastName}`,
          distance: item.doc.distance,
        }
      });
      try{
        sender.send(
          message,
          { registrationTokens: followerFCMTokens },
          (err, response) => {
            if (err) console.error(err);
            else console.log(response);
          }
        );
      } catch (e) {
        console.log(e)
      }
    }
  })
}

function startChangesFeedForElastic () {
  // @TODO: this is going to have to change when there are
  // a ton of changes, or it will be loading them all every
  // time the backend boots.
  let iterator = slouch.db.changes('users', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
  })

  iterator.each(async (item) => {
    if (item.doc && item.doc.type === 'user') {
      console.log('updating elasticsearch record: ' + item.doc._id)
      await ESClient.update({
        index: 'users',
        type: 'users',
        body: {
          doc: {
            email: item.doc.email,
            firstName: item.doc.firstName,
            lastName: item.doc.lastName,
            profilePhotoID: item.doc.profilePhotoID,
            photosByID: item.doc.photosByID,
            aboutMe: item.doc.aboutMe,
          },
        doc_as_upsert: true,
        },
        id: item.doc._id,

      })
    }
    if (item.deleted) {
      try {
        await ESClient.delete({
          index: 'users',
          type: 'users',
          id: item.doc._id
        })
        console.log('deleting elasticsearch record: ' + item.doc._id)
      } catch (e) {}
    }
    return Promise.resolve()
  })
}

app.post('/inquiries', bodyParser.json(), async (req, res) => {
  const email = req.body.email
  const type = req.body.type
  await slouch.doc.create(INQUIRIES_DB, {
    email, type
  })
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
  // @TODO: 'split this into public and private records'
  const newUser = await slouch.doc.create(USERS_DB, {
    email,
    password: hashed,
    firstName: null,
    lastName: null,
    aboutMe: null,
    profilePhotoID: null,
    photosByID: {},
    ridesDefaultPublic: true,
    type: 'user',
    createTime: unixTimeNow()
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
  console.log('user logging in')
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
    )

    const following = await slouch.db.viewArray(
      USERS_DB,
      USERS_DESIGN_DOC,
      'following',
      { key: `"${found[0].id}"`}
    )
    const followers = await slouch.db.viewArray(
      USERS_DB,
      USERS_DESIGN_DOC,
      'followers',
      { key: `"${found[0].id}"`}
    )
    return res.json({
      id: found[0].id,
      followers: followers.rows.map(f => f.value),
      following: following.rows.map(f => f.value),
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
  if (found.length < 1 || code !== found[0].doc.pwResetCode) {
    return res.status(401).json({'error': 'Wrong email/code.'})
  } else if (found.length === 1) {
    const doc = found[0].doc
    const token = jwt.sign(
      {
        id: found[0].id,
        email,
      },
      configGet(TOP_SECRET_JWT_TOKEN)
    );
    const following = await slouch.db.viewArray(
      USERS_DB,
      USERS_DESIGN_DOC,
      'following',
      { key: `"${found[0].id}"`}
    )
    const followers = await slouch.db.viewArray(
      USERS_DB,
      USERS_DESIGN_DOC,
      'followers',
      { key: `"${found[0].id}"`}
    )

    const newDoc = Object.assign({}, doc, { pwResetCode: null })
    await slouch.doc.update(USERS_DB, newDoc)
    return res.json({
      id: found[0].id,
      following:  following.rows.map(f => f.value),
      followers: followers.rows.map(f => f.value),
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

app.get('*.php', (req, res) => {
  return res.json({fuck: 'you'})
})

const userMeta = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'equesteo-profile-photos-2',
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
    bucket: 'equesteo-horse-photos',
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
    bucket: 'equesteo-ride-photos-2',
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
  const qResp = await ESClient.search({
    index: 'users',
    q: query
  })
  const docs = []
  for (let hit of qResp.hits.hits) {
    const doc = Object.assign({}, hit._source)
    doc._id = hit._id
    delete doc.email
    docs.push(doc)
  }
  console.log(docs)
  return res.json(docs)
})

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});

