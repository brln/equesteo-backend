import mbxStatic from '@mapbox/mapbox-sdk/services/static'
import DynamoDBService from './services/dynamoDB'

import { USERS_DB} from "./design_docs/users"
import { HORSES_DB } from "./design_docs/horses"
import { RIDES_DB} from './design_docs/rides'

import {
  configGet,
  MAPBOX_TOKEN,
  NODE_ENV,
} from "./config"

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

let count = 0
app.get('/changeMaps', async (req, res) => {
  const staticService = mbxStatic({accessToken: configGet(MAPBOX_TOKEN)})
  await slouch.doc.all(RIDES_DB, {include_docs: true}).each(async (item) => {
    if (item.doc.type === 'ride') {
      console.log(count)
      const coordinates = await slouch.doc.get(RIDES_DB, `${item.doc._id}_coordinates`, {include_docs: true})
      const parsed = coordinates.rideCoordinates.reduce((accum, coord) => {
        accum.push([coord[1], coord[0]])
        return accum
      }, [])
      const request = await staticService.getStaticImage({
        ownerId: 'equesteo',
        styleId: 'cjn3zysq408tc2sk1g1gunqmq',
        width: 600,
        height: 400,
        position: 'auto',
        overlays: [{
          path: {
            strokeWidth: 5,
            strokeColor: 'ea5b60',
            coordinates: parsed
          }
        }]
      })
      item.doc.mapURL = request.url()
      await slouch.doc.update(RIDES_DB, item.doc)
      count += 1
    }
  })
  return res.json({'all': 'done'})
})

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
