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

app.get('/createRideHorsesForAll', (req, res, next) => {
  new Promise((resolve, reject) => {
    const updates = []
    slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'ridesByID', {include_docs: true}).each(ride => {
      if (ride.doc.horseID) {
        const rideHorses = []
        return slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'rideHorsesByRide', {include_docs: true, key: `"${ride.doc._id}"`}).each(rideHorse => {
          rideHorses.push(rideHorse.doc.horseID)
        }).then(() => {
          if (rideHorses.length === 0) {
            const recordID = `${ride.doc._id}_${ride.doc.horseID}_${'rider'}`
            const newRideHorse = {
              _id: recordID,
              rideID: ride.doc._id,
              horseID: ride.doc.horseID,
              rideHorseType: 'rider',
              type: 'rideHorse',
              timestamp: unixTimeNow(),
              userID: ride.doc.userID,
            }
            updates.push(slouch.doc.create(RIDES_DB, newRideHorse))
          }
          delete ride.doc.horseID
          updates.push(slouch.doc.update(RIDES_DB, ride.doc))
        })
      }
    }).then(() => {
      return Promise.all(updates)
    }).then(() => {
      resolve()
    }).catch(e => {
      reject(e)
    })
  }).then(() => {
    res.json('done')
  }).catch(e => {
    next(e)
  })
})

export function postRide (app) {
  const upload = multer({ storage: multer.memoryStorage() })
  const METERS_TO_FEET = 3.28084
  app.post("/gpxUploader", authenticator, upload.single('file'), (req, resp) => {
    let fileBuffer = req.file.buffer
    xml2js.parseString(fileBuffer, (err, res) => {
      const points = res.gpx.trk[0].trkseg[0].trkpt
      const parsedPoints = []
      const parsedElevations = {}
      let distance = 0
      let gain = 0

      let lastPoint = null
      let lastElevation = null
      let startTime = null
      let lastTime = null
      for (let point of points) {
        const timestamp = Date.parse(point.time[0])
        if (!lastTime || timestamp > lastTime) {
          lastTime = timestamp
        }
        const lat = parseFloat(point.$.lat)
        const long = parseFloat(point.$.lon)
        const elevation = parseFloat(point.ele[0]) * METERS_TO_FEET
        startTime = startTime ? startTime : timestamp
        if (lastPoint) {
          distance += haversine(lastPoint.lat, lastPoint.long, lat, long)
          gain += elevation - lastElevation > 0 ? elevation - lastElevation : 0
        }
        lastPoint = { lat, long }
        lastElevation = elevation
        parsedPoints.push({
          latitude: lat,
          longitude: long,
          accuracy: null,
          timestamp,
        })

        if (!parsedElevations[lat.toFixed(4)]) {
          parsedElevations[lat.toFixed(4)] = {}
        }
        parsedElevations[lat.toFixed(4)][long.toFixed(4)] = Math.round(elevation)
      }

      const rideID = `${resp.locals.userID}_${(new Date).getTime().toString()}`
      const ride = {
        _id: rideID,
        coverPhotoID: null,
        distance,
        elapsedTimeSecs: (lastTime - startTime) / 1000,
        rideCoordinates: parsedPoints,
        photosByID: {},
        startTime,
        type: 'ride',
        userID: resp.locals.userID,
        isPublic: false,
      }
      ride.name = newRideName(ride)
      ride.mapURL = staticMap(ride)
      slouch.doc.create(RIDES_DB, ride)
      const rideElevations = {
        _id: rideID + '_elevations',
        rideID: rideID,
        elevationGain: gain,
        elevations: parsedElevations,
        type: 'rideElevations',
        userID: resp.locals.userID,
      }
      slouch.doc.create(RIDES_DB, rideElevations)
    })

    return resp.json({})
  })
}

app.get('/fixElevations', (req, res) => {
  function metersToFeet (meters) {
    return meters * 3.28084
  }

  function newElevationGain (distance, lastElevation, newElevation, oldTotal) {
    let newTotal = oldTotal
    const diff = metersToFeet(Math.abs(newElevation - lastElevation))
    if (diff) {
      const grade = diff / (distance * 5280)
      if (grade < 0.5) {
        const elevationChange = newElevation - lastElevation
        newTotal = oldTotal + (elevationChange > 0 ? elevationChange : 0)
      }
    }
    return newTotal
  }

  function parseElevationData (rideCoordinates, rideElevations) {
    let totalGain = 0
    let lastPoint = null

    for (let rideCoord of rideCoordinates.rideCoordinates) {
      const latEl = rideElevations.elevations[rideCoord[0].toFixed(4)]
      const elevation = latEl ? latEl[rideCoord[1].toFixed(4)] : null
      if (elevation) {
        if (lastPoint) {
          const newDistance = haversine(
            lastPoint[0],
            lastPoint[1],
            rideCoord[0],
            rideCoord[1]
          )

          const lastElevation = rideElevations.elevations[lastPoint[0].toFixed(4)][lastPoint[1].toFixed(4)]
          totalGain = newElevationGain(newDistance, lastElevation, elevation, totalGain)
        }
        lastPoint = rideCoord
      }
    }
    return totalGain
  }

  const rides = {}
  const rideCoordinates = {}
  const rideElevations = {}
  slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'rideData', {include_docs: true}).each(doc => {
    if (doc.doc.type === 'ride') {
      rides[doc.doc._id] = doc.doc
    } else if (doc.doc.type === 'rideElevations') {
      rideElevations[doc.doc._id] = doc.doc
    } else if (doc.doc.type === 'rideCoordinates') {
      rideCoordinates[doc.doc._id] = doc.doc
    }
  }).then(() => {
    const docUpdates = []
    for (let rideID of Object.keys(rides)) {
      console.log(rideID)
      const coords = rideCoordinates[rideID + '_coordinates']
      const elevations = rideElevations[rideID + '_elevations']
      if (elevations) {
        const gain = parseElevationData(coords, elevations)
        const newDoc = Object.assign({}, elevations, {elevationGain: gain})
        docUpdates.push(slouch.doc.upsert(RIDES_DB, newDoc))
      }
    }
    return Promise.all(docUpdates)
  }).then(() => {
    res.sendStatus(200)
  })
})

app.get('/resizeAllImages', (req, res) => {
  function uploadPhoto (photo, bucket) {
    const splitup = photo.doc.uri.split('/')
    const filename = splitup[splitup.length - 1]
    return new Promise((res, rej) => {
      fetch(photo.doc.uri).then(res => {
        return res.buffer()
      }).then(buffer => {
        return PhotoUploader.uploadPhoto(buffer, filename, bucket, true)
      }).then(() => {
        res()
      }).catch(e => {
        rej(e)
      })
    })
  }

  slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'userPhotos', {include_docs: true}).each(userPhoto => {
    if (userPhoto.doc.uri.startsWith('https://')) {
      return uploadPhoto(userPhoto, 'equesteo-profile-photos-2').catch(e => { console.log(userPhoto )})
    }
  }).then(() => {
    return slouch.db.view(HORSES_DB, HORSES_DESIGN_DOC, 'horsePhotos', {include_docs: true}).each(horsePhoto => {
      if (horsePhoto.doc.uri.startsWith('https://')) {
        return uploadPhoto(horsePhoto, 'equesteo-horse-photos').catch(e => { console.log(horsePhoto)})
      }
    })
  }).then(() => {
    return slouch.db.view(RIDES_DB, RIDES_DESIGN_DOC, 'ridePhotos', {include_docs: true}).each(ridePhoto => {
      if (ridePhoto.doc.uri.startsWith('https://')) {
        return uploadPhoto(ridePhoto, 'equesteo-ride-photos-2').catch(e => { console.log(ridePhoto)})
      }
    })
  }).then(() => {
    res.json({'all': 'done'})
  }).catch(e => {
    console.log(e)
    next(e)
  })
})
