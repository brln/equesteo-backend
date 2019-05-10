export const HORSES_DB = 'horses'
export const HORSES_DESIGN_DOC = '_design/horses'

export function createHorsesDesignDoc (slouch) {
  slouch.db.create(HORSES_DB).then(() => {
    slouch.doc.createOrUpdate(HORSES_DB, {
      _id: HORSES_DESIGN_DOC,
      validate_doc_update: function (newDoc, oldDoc, userCtx, secObj) {
        const sourceUserID = userCtx.name
        if (sourceUserID === 'equesteo') {
          return
        }

        if (oldDoc && oldDoc.type !== newDoc.type) {
          log('bad horse update 1')
          throw({forbidden: `Bad horse doc update 1: ${oldDoc._id}, ${sourceUserID}`});
        }
        const allTypes = [
          'careEvent',
          'horse',
          'horseCareEvent',
          'horsePhoto',
          'horseUser'
        ]
        if (!newDoc.type || allTypes.indexOf(newDoc.type) < 0) {
          log('bad horse update 2')
          throw({forbidden: `Bad horse doc update 2: ${oldDoc._id}, ${sourceUserID}`});
        }

        const userCheckTypes = [
          'careEvent',
          'horseCareEvent',
        ];
        if (userCheckTypes.indexOf(newDoc.type) > -1 && newDoc.userID !== sourceUserID) {
          log(`Bad horse doc update 3: ${oldDoc._id}, ${sourceUserID}`)
          throw({forbidden: `Bad horse doc update 3: ${oldDoc._id}, ${sourceUserID}`});
        }
      }.toString(),
      views: {
        types: {
          map: function (doc) {
            emit(doc.type, null)
          }.toString(),
          reduce: '_count'
        },
        horseUsersByUserID: {
          map: function (doc) {
            if (doc.type === 'horseUser') {
              emit(doc.userID, null)
            }
          }.toString()
        },
        horseUsersByHorseID: {
          map: function (doc) {
            if (doc.type === 'horseUser') {
              emit(doc.horseID, doc._id)
            }
          }.toString()
        },
        allJoins: {
          map: function (doc) {
            if (doc.type === 'horseUser' || doc.type === 'horsePhoto') {
              emit(doc.userID, doc.horseID)
            }
          }.toString()
        },
        allJoins2: {
          map: function (doc) {
            if (doc.type === 'horseUser' || doc.type === 'horsePhoto' || doc.type === 'horseCareEvent') {
              emit(doc.userID, doc.horseID)
            } else if (doc.type === 'careEvent') {
              emit(doc.userID, doc._id)
            }
          }.toString()
        },
        horsePhotos: {
          map: function (doc) {
            if (doc.type === 'horsePhoto') {
              emit(doc._id, null)
            }
          } .toString()
        }
      },
      filters: {
        byID: function (doc, req) {
          let ids = req.query.ids.split(',');
          return ids.indexOf(doc._id) >= 0;
        }.toString()
      }
    })
  })
}

