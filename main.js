import express from 'express'
import bodyParser from 'body-parser'
import Slouch from 'couch-slouch'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import proxy from 'express-http-proxy'
import aws from 'aws-sdk'
import multer from 'multer'
import multerS3 from 'multer-s3'
import path from 'path'
import xml2js from 'xml2js'

import { haversine } from './helpers'

import {
  configGet,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  COUCH_HOST,
  COUCH_PASSWORD,
  COUCH_USERNAME,
  TOP_SECRET_JWT_TOKEN
} from "./config"
import { currentTime } from './helpers'

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
app.use("/gpxUploader", express.static(path.join(__dirname, 'frontend', 'build')))


const upload = multer({ storage: multer.memoryStorage() })
app.post("/gpxUploader", authenticator, upload.single('file'), (req, resp) => {
   let fileBuffer = req.file.buffer
   xml2js.parseString(fileBuffer, (err, res) => {
     const points = res.gpx.trk[0].trkseg[0].trkpt
     const parsedPoints = []
     let distance = 0
     let lastPoint = null
     let startTime = null
     let lastTime = null
     for (let point of points) {
       const timestamp = Date.parse(point.time[0])
       if (!lastTime || timestamp > lastTime) {
         lastTime = timestamp
       }
       const lat = parseFloat(point.$.lat)
       const long = parseFloat(point.$.lon)
       startTime = startTime ? startTime : timestamp
       if (lastPoint) {
         distance += haversine(lastPoint.lat, lastPoint.long, lat, long)
       }
       lastPoint = { lat, long }
       parsedPoints.push({
         latitude: lat,
         longitude: long,
         accuracy: null,
         timestamp,
       })
     }
     const ride = {
       coverPhotoID: null,
       elapsedTimeSecs: (lastTime - startTime) / 1000,
       type: 'ride',
       rideCoordinates: parsedPoints,
       distance,
       photosByID: {},
       startTime,
       userID: resp.locals.userID,
     }
     slouch.doc.create(RIDES_DB, ride)
   })
})

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
      },
      followers: {
        map: function (doc) {
          if( doc.following.length > 0 ) {
            for(var i = 0; i < doc.following.length ; i++) {
              emit( doc.following[i], doc._id );
            }
          }
        }.toString()
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

app.use('/couchproxy', authenticator, proxy(`http://${configGet(COUCH_HOST)}`, {
  proxyReqOptDecorator: async (proxyReqOpts, srcReq) => {
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

