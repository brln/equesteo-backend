export const HORSES_DB = 'horses'
export const HORSES_DESIGN_DOC = '_design/horses'

export function createHorsesDesignDoc (slouch) {
  slouch.db.create(HORSES_DB).then(() => {
    slouch.doc.createOrUpdate(HORSES_DB, {
      _id: HORSES_DESIGN_DOC,
      views: {
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

