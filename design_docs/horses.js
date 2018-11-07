export const HORSES_DB = 'horses'
export const HORSES_DESIGN_DOC = '_design/horses'

export function createHorsesDesignDoc (slouch) {
  slouch.db.create(HORSES_DB).then(() => {
    slouch.doc.createOrUpdate(HORSES_DB, {
      _id: HORSES_DESIGN_DOC,
      views: {
        allJoins: {
          map: function (doc) {
            if (doc.type === 'horseUser' || doc.type === 'horsePhoto') {
              emit(doc.userID, doc.horseID)
            }
          }.toString()
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

