import express from 'express'
import * as Sentry from '@sentry/node'

import { couchAuthenticator } from '../auth'
import {configGet, COUCH_HOST, USER_COUCHDB_PASSWORD} from '../config'
import CouchService from '../services/Couch'
import DynamoDBService from '../services/dynamoDB'
import Logging from '../services/Logging'

const USERS_TABLE_NAME = 'equesteo_users'

const router = express.Router()



const HORSE_DB = 'horses'
const NOTIFICATIONS_DB = 'notifications'
const RIDE_DB = 'rides'
const USERS_DB = 'users'
const VALID_DBS = [
  HORSE_DB,
  NOTIFICATIONS_DB,
  RIDE_DB,
  USERS_DB
]
const DB_REG = `:db(${VALID_DBS.join('|')})`

const REQUIRED_FILTERS = {}
REQUIRED_FILTERS[HORSE_DB] = '_doc_ids'
REQUIRED_FILTERS[USERS_DB] = 'users/byUserIDs2'
REQUIRED_FILTERS[RIDE_DB] = 'rides/byUserIDs'
REQUIRED_FILTERS[NOTIFICATIONS_DB] = 'notifications/byUserIDs'


function checkDB (req, res, next) {
  if (VALID_DBS.includes(req.params.db)) {
    next()
  } else {
    res.sendStatus(401)
  }
}

function checkFilter(req, res, next) {
  const required = REQUIRED_FILTERS[req.params.db]
  if (!req.query.filter || req.query.filter !== required) {
    res.sendStatus(401)
  } else {
    next()
  }
}

function userCouchService (id) {
  // return new CouchService(configGet(COUCH_USERNAME), configGet(COUCH_PASSWORD), configGet(COUCH_HOST))
  return new CouchService(id, configGet(USER_COUCHDB_PASSWORD), configGet(COUCH_HOST))
}

router.get('/', couchAuthenticator, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getInfo()).pipe(res)
})

router.get(`/${DB_REG}/`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getDBInfo(req.params.db)).pipe(res)
})

router.get(`/${DB_REG}/_local/:id`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getLocalDoc(req.params.db, req.params.id, req.query)).pipe(res)
})

router.put(`/${DB_REG}/_local/:id`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.putLocalDoc(req.params.db, req.params.id, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_revs_diff`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postRevDiffs(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_revs_diff`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getRevDiffs(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_design/:designDoc/_view/:view`, checkDB, couchAuthenticator, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getView(req.params.db, req.params.designDoc, req.params.view, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_design/:designDoc/_view/:view`, checkDB, couchAuthenticator, (req, res, next) => {
  // Same thing as GET view but posts the ids when they don`t fit in url
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postView(req.params.db, req.params.designDoc, req.params.view, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_changes`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postChanges(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/_changes`, couchAuthenticator, checkDB, checkFilter, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getChanges(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_all_docs`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postAllDocs(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_bulk_docs`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postBulkDocs(req.params.db, req.query)).pipe(res)
})

router.post(`/${DB_REG}/_bulk_get`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.postBulkGet(req.params.db, req.query)).pipe(res)
})

router.get(`/${DB_REG}/:id`, couchAuthenticator, checkDB, (req, res, next) => {
  const uCouchService = userCouchService(res.locals.userID)
  req.pipe(uCouchService.getItem(req.params.db, req.params.id, req.query)).pipe(res)
})

function captureEvent (id) {
  Sentry.captureMessage(`CouchdDB Anomaly, major fucking problem: ${id}`, Sentry.Severity.Critical)
}

function disableAccount (email) {
  const ddbService = new DynamoDBService()
  ddbService.getItem(USERS_TABLE_NAME, { email: {S: email }}).then(item => {
    item.enabled = { BOOL: false }
    return ddbService.putItem(USERS_TABLE_NAME, item)
  }).catch(e => {
    Logging.log(e, 'error disabling nefarious account')
  })
}

function badRoute (req, res, next) {
  captureEvent(res.locals.userID)
  disableAccount(res.locals.userEmail)
  res.sendStatus(401)
}

router.get('/*', couchAuthenticator, badRoute)
router.post('/*', couchAuthenticator, badRoute)
router.put('/*', couchAuthenticator, badRoute)
router.patch('/*', couchAuthenticator, badRoute)
router.delete('/*', couchAuthenticator, badRoute)



module.exports = router
