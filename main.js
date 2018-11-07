import aws from 'aws-sdk'
import express from 'express'
import gcm from 'node-gcm'
import multer from 'multer'
import multerS3 from 'multer-s3'
import path from 'path'
import Slouch from 'couch-slouch'
import elasticsearch from 'elasticsearch'
import * as Sentry from '@sentry/node'

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
  NODE_ENV,
} from "./config"
import { currentTime } from './helpers'
import { postRide } from './controllers/gpxUploader'
import { couchProxy } from './controllers/couchProxy'
import { users } from './controllers/users'
import { createUsersDesignDoc, USERS_DB, USERS_DESIGN_DOC } from "./design_docs/users"
import { createHorsesDesignDoc, HORSES_DB } from "./design_docs/horses"
import { createRidesDesignDoc, RIDES_DB } from './design_docs/rides'
import DynamoDBService from './services/dynamoDB'

const app = express()

if (configGet(NODE_ENV) !== 'local') {
  Sentry.init({dsn: 'https://04b0f2944b3d43af8fc7d039a8bb6359@sentry.io/1305626'});
  app.use(Sentry.Handlers.requestHandler());
}


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

      const followerFCMTokens = []
      for (let follower of followers.rows) {
        let found
        try {
          found = await ddbService.getItem(TABLE_NAME, { id: {S: follower.value._id }})
        } catch (e) {
          console.log('id not found: ' + e)
        }

        if (found && found.fcmToken.S) {
          followerFCMTokens.push(found.fcmToken.S)
        }
      }
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
                console.log('FCM send response: ============')
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

app.get('/errorTest', function mainHandler(req, res) {
  throw new Error('Broke!');
});

app.get('/moveRideCoords', async (req, res) => {
  await slouch.doc.all(RIDES_DB, {include_docs: true}).each(async (item) => {
    if (item.doc.type === 'ride') {
      const rideCoordinates = item.doc.rideCoordinates
      const newRideCoords = rideCoordinates.map(coord => {
        return [
          Number(coord.latitude.toFixed(6)),
          Number(coord.longitude.toFixed(6)),
          coord.timestamp,
          coord.accuracy ? Number(coord.accuracy.toFixed(2)) : null
        ]
      })
      const coordDoc = {
        _id: item.doc._id + '_coordinates',
        rideCoordinates: newRideCoords,
        rideID: item.doc._id,
        userID: item.doc.userID,
        type: 'rideCoordinates',
      }
      delete item.doc.rideCoordinates
      await slouch.doc.create(RIDES_DB, coordDoc)
      await slouch.doc.update(RIDES_DB, item.doc)
    }
  })

  const horses = {}
  const horseUsers = []
  await slouch.doc.all(HORSES_DB, {include_docs: true}).each(async (item) => {
    if (item.doc.type === 'horseUser' && item.doc.owner) {
      horseUsers.push(item.doc)
    } else if (item.doc.type === 'horse') {
      horses[item.doc._id] = item.doc
    }
  })

  for (let horseUser of horseUsers) {
    const horse = horses[horseUser.horseID]
    const photos = horse.photosByID
    for (let photoID of Object.keys(photos)) {
      const newPhotoDoc = {
        _id: photoID,
        horseID: horse._id,
        timestamp: photos[photoID].timestamp,
        type: 'horsePhoto',
        uri: photos[photoID].uri,
        userID: horseUser.userID,
      }
      await slouch.doc.create(HORSES_DB, newPhotoDoc)
    }
    delete horse.photosByID
    delete horse.userID
    await slouch.doc.update(HORSES_DB, horse)
  }


  await slouch.doc.all(RIDES_DB, {include_docs: true}).each(async (item) => {
    if (item.doc.type === 'ride') {
      for (let photoID of Object.keys(item.doc.photosByID)) {
        const newPhotoDoc = {
          _id: photoID,
          rideID: item.doc._id,
          timestamp: item.doc.photosByID[photoID].timestamp,
          type: 'ridePhoto',
          uri: item.doc.photosByID[photoID].uri,
          userID: item.doc.userID,
        }
        await slouch.doc.create(RIDES_DB, newPhotoDoc)
      }
      delete item.doc.photosByID
      await slouch.doc.update(RIDES_DB, item.doc)
    }
  })

  await slouch.doc.all(USERS_DB, {include_docs: true}).each(async (item) => {
    if (item.doc.type === 'user') {
      for (let photoID of Object.keys(item.doc.photosByID)) {
        const newPhotoDoc = {
          _id: photoID,
          userID: item.doc._id,
          timestamp: item.doc.photosByID[photoID].timestamp,
          type: 'userPhoto',
          uri: item.doc.photosByID[photoID].uri,
        }
        await slouch.doc.create(USERS_DB, newPhotoDoc)
      }
      delete item.doc.photosByID
      await slouch.doc.update(USERS_DB, item.doc)
    }
  })



  return res.json({'done': "now"})
})

// app.get('/replicateProd', async (req, res) => {
//   if (configGet(NODE_ENV) !== 'local') {
//     return res.json({'not for': "you"})
//   }
//   console.log('destroying local DBs')
//   try {
//     const destroys = [
//       slouch.db.destroy(RIDES_DB),
//       slouch.db.destroy(USERS_DB),
//       slouch.db.destroy(HORSES_DB),
//     ]
//     try {
//        await Promise.all(destroys)
//     } catch (e) {
//       if (e.error !== 'not_found') {
//         throw e
//       }
//     }
//
//
//     console.log('recreating local dbs')
//     const creates =[
//       slouch.db.create(RIDES_DB),
//       slouch.db.create(USERS_DB),
//       slouch.db.create(HORSES_DB),
//     ]
//     try {
//       await Promise.all(creates)
//     } catch (e) {
//       console.log('wtf')
//       throw e
//     }
//
//     const prodCouch = `http://equesteo:${process.env.PROD_COUCH_PASSWORD}@ec2-52-9-138-254.us-west-1.compute.amazonaws.com:5984/`
//     const dbs = ['horses', 'rides', 'users']
//
//     const replications = []
//     for (let db of dbs) {
//       console.log(`starting replicating ${db}`)
//       replications.push(slouch.db.replicate({
//         source: prodCouch + db,
//         target: db
//       }))
//     }
//     await Promise.all(replications)
//     console.log('replications complete')
//
//     const tableName = 'equesteo_users'
//     const ddbService = new DynamoDBService()
//     console.log('deleting dynamoDB users table')
//     try{
//       await ddbService.deleteTable(tableName)
//     } catch (e) {
//       console.log('skipping delete')
//     }
//     console.log('creating dynamoDB users table')
//     await ddbService.createTable('email', 'S', tableName)
//
//     const prodDDBService = new DynamoDBService('production')
//     const allItems = await prodDDBService.getAllItems(tableName)
//     const putPromises = []
//     for (let item of allItems) {
//       const putItem = {
//         password: {S: item.password},
//         id: {S: item.id},
//         email: {S: item.email}
//       }
//       putPromises.push(ddbService.putItem(tableName, putItem))
//     }
//     await Promise.all(putPromises)
//   }
//   catch (e) {
//     console.log(e)
//     return res.json({'error': e.toString()})
//   }
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

if (configGet(NODE_ENV) !== 'local') {
  app.use(Sentry.Handlers.errorHandler());
}

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});

