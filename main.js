import aws from 'aws-sdk'
import express from 'express'
import gcm from 'node-gcm'
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
} from "./config"
import { currentTime } from './helpers'
import { postRide } from './controllers/gpxUploader'
import { couchProxy } from './controllers/couchProxy'
import { users } from './controllers/users'
import { createUsersDesignDoc, USERS_DB, USERS_DESIGN_DOC } from "./design_docs/users"
import { createHorsesDesignDoc } from "./design_docs/horses"
import { createRidesDesignDoc } from './design_docs/rides'
import DynamoDBService from './services/dynamoDB'

const app = express()
const s3 = new aws.S3()

aws.config.update({
  secretAccessKey: configGet(AWS_SECRET_ACCESS_KEY),
  accessKeyId: configGet(AWS_ACCESS_KEY_ID),
  region: 'us-west-1'
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
users(app)

startChangesFeedForElastic()
startChangesFeedForPush()

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})



function startChangesFeedForPush() {
  let iterator = slouch.db.changes('rides', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
    since: 'now'
  })

  const sender = new gcm.Sender(configGet(GCM_API_KEY));

  const ddbService = new DynamoDBService()
  const TABLE_NAME = 'equesteo_fcm_tokens'

  iterator.each(async (item) => {
    if (item.doc && item.doc.type === 'ride'
      && item.doc._rev.split('-')[0] === '1'
      && item.doc.isPublic === true) {
      const userID = item.doc.userID
      if (!userID) throw Error('wut why not')
      const followers = await slouch.db.viewArray(
        USERS_DB,
        USERS_DESIGN_DOC,
        'followers',
        { key: `"${userID}"` }
      )
      console.log(`found ${followers.rows.length} follower records in couch`)

      const followerFCMTokens = await followers.rows.reduce(async (r, e) => {
        let found
        try {
          found = await ddbService.getItem(TABLE_NAME, { id: {S: e.value._id }})
        } catch (e) {
          console.log('id not found: ' + e)
        }

        if (found && found.fcmToken.S) {
          r.push(found.fcmToken.S)
        }
        return r
      }, [])
      console.log(`found ${followerFCMTokens.length} follower tokens in dynamodb`)

      if (followerFCMTokens.length > 0) {
        console.log('attempting to send FCM messages')
        const user = await slouch.doc.get(USERS_DB, item.doc.userID)
        const message = new gcm.Message({
          data: {
            rideID: item.doc._id,
            userID: item.doc.userID,
            userName: `${user.firstName} ${user.lastName}`,
            distance: item.doc.distance,
          },
          priority: 'high'
        });
        try {
          sender.send(
            message,
            {registrationTokens: followerFCMTokens},
            (err, response) => {
              if (err) {
                console.error(err);
              } else {
                console.log('fmc send success')
                console.log(response);
              }
            }
          );
        } catch (e) {
          console.log(e)
        }
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

app.get('/createFCMDB', async (req, res) => {
  const tableName = 'equesteo_fcm_tokens'
  try {
    const ddbService = new DynamoDBService()
    await ddbService.deleteTable(tableName)
  } catch (e) {}

  const ddbService = new DynamoDBService()
  await ddbService.createTable('id', 'S', tableName)
  return res.json({"all": "done"})
})

// app.get('/createUsersDB', async (req, res) => {
//   const tableName = 'equesteo_users'
//   try {
//     const ddbService = new DynamoDBService()
//     await ddbService.deleteTable(tableName)
//   } catch (e) {}
//
//   const ddbService = new DynamoDBService()
//   await ddbService.createTable('email', 'S', tableName)
//   return res.json({"all": "done"})
// })
//
// app.get('/migrateUsersData', async (req, res) => {
//   const tableName = 'equesteo_users'
//   const ddbService = new DynamoDBService()
//   slouch.doc.all(USERS_DB, {include_docs: true}).each(async (item) => {
//     if (item.doc.type === 'user') {
//       const newItem = {}
//       newItem.email = {S: item.doc.email}
//       newItem.password = {S: item.doc.password}
//       newItem.id = {S: item.doc._id}
//       if (item.doc.fcmToken) {
//         newItem.fcmToken = {S: item.doc.fcmToken}
//       }
//       await ddbService.putItem(tableName, newItem)
//       const resp = await ddbService.getItem(tableName, { email: {S: item.doc.email }})
//       console.log(resp)
//     }
//   })
//   return res.json({'done': "now"})
// })

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

