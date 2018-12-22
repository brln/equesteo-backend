import aws from 'aws-sdk'
import express from 'express'
import gcm from 'node-gcm'
import logger from 'morgan'
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
  LOGGING_TYPE,
  NODE_ENV,
} from "./config"
import { postRide } from './controllers/gpxUploader'
import { couchProxy } from './controllers/couchProxy'
import { users } from './controllers/users'
import { createUsersDesignDoc, USERS_DB } from "./design_docs/users"
import { createHorsesDesignDoc, HORSES_DB } from "./design_docs/horses"
import { createRidesDesignDoc, RIDES_DB } from './design_docs/rides'

import startRideChangeIterator from './ChangeIterators/rides'
import startUsersChangeIterator from './ChangeIterators/users'
import DynamoDBService from './services/dynamoDB'

const app = express()
app.use(logger(configGet(LOGGING_TYPE)))

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

const ESClient = new elasticsearch.Client({
  host: configGet(ELASTICSEARCH_HOST),
})

const gcmClient = new gcm.Sender(configGet(GCM_API_KEY));

const ddbService = new DynamoDBService()


startUsersChangeIterator(ESClient, slouch)
startRideChangeIterator(slouch, gcmClient, ddbService)


app.get('/errorTest', (req, res) => {
  throw new Error('Broke!');
});

app.get('/unauthorizedTest', (req, res) => {
  console.log('unauthorized test')
  return res.status(401).json({error: 'Invalid Authorization header'})
})

app.get('/checkAuth', authenticator, (req, res) => {
  return res.json({})
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
  return res.json(docs)
})


app.get('/replicateProd', async (req, res) => {
  if (configGet(NODE_ENV) !== 'local') {
    return res.json({'not for': "you"})
  }
  console.log('destroying local DBs')
  try {
    const destroys = [
      slouch.db.destroy(RIDES_DB),
      slouch.db.destroy(USERS_DB),
      slouch.db.destroy(HORSES_DB),
    ]
    try {
      await Promise.all(destroys)
    } catch (e) {
      if (e.error !== 'not_found') {
        throw e
      }
    }

    console.log('recreating local dbs')
    const creates =[
      slouch.db.create(RIDES_DB),
      slouch.db.create(USERS_DB),
      slouch.db.create(HORSES_DB),
    ]
    try {
      await Promise.all(creates)
    } catch (e) {
      console.log('wtf')
      throw e
    }

    const prodCouch = `http://equesteo:${process.env.PROD_COUCH_PASSWORD}@ec2-52-9-138-254.us-west-1.compute.amazonaws.com:5984/`
    const dbs = ['horses', 'rides', 'users']

    const replications = []
    for (let db of dbs) {
      console.log(`starting replicating ${db}`)
      replications.push(slouch.db.replicate({
        source: prodCouch + db,
        target: db
      }))
    }
    await Promise.all(replications)
    console.log('replications complete')

    const tableName = 'equesteo_users'
    const ddbService = new DynamoDBService()
    console.log('deleting dynamoDB users table')
    try{
      await ddbService.deleteTable(tableName)
    } catch (e) {
      console.log('skipping delete')
    }
    console.log('creating dynamoDB users table')
    await ddbService.createTable('email', 'S', tableName)

    const prodDDBService = new DynamoDBService('production')
    const allItems = await prodDDBService.getAllItems(tableName)
    const putPromises = []
    for (let item of allItems) {
      const putItem = {
        password: {S: item.password},
        id: {S: item.id},
        email: {S: item.email}
      }
      putPromises.push(ddbService.putItem(tableName, putItem))
    }
    await Promise.all(putPromises)
  }
  catch (e) {
    console.log(e)
    return res.json({'error': e.toString()})
  }
  return res.json({'done': "now"})
})

if (configGet(NODE_ENV) !== 'local') {
  app.use(Sentry.Handlers.errorHandler());
}

const errorHandler = (err, req, res, next) => {
  console.log(err);
  res.sendStatus(500);
};

app.use(errorHandler)

app.listen(process.env.PORT || 8080, '0.0.0.0', function () {
  console.log('Example app listening on port 8080!');
});

