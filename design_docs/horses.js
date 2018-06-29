export const HORSES_DB = 'horses'
export const HORSES_DESIGN_DOC = '_design/horses'

export function createHorsesDesignDoc (slouch) {
  slouch.db.create(HORSES_DB).then(() => {
    slouch.doc.createOrUpdate(HORSES_DB, {
      _id: HORSES_DESIGN_DOC,
      filters: {
        byUserIDs: function (doc, req) {
          let userIDs = req.query.userIDs.split(',');
          return userIDs.indexOf(doc.userID) >= 0;
        }.toString()
      }
    })
  })
}

