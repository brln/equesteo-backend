export const NOTIFICATIONS_DB = 'notifications'
export const NOTIFICATIONS_DESIGN_DOC = '_design/notifications'

export function createNotificationsDesignDoc (slouch) {
  slouch.db.create(NOTIFICATIONS_DB).then(() => {
    slouch.doc.createOrUpdate(NOTIFICATIONS_DB, {
      _id: NOTIFICATIONS_DESIGN_DOC,
      validate_doc_update: function (newDoc, oldDoc, userCtx, secObj) {
        const sourceUserID = userCtx.name
        if (sourceUserID === 'equesteo') {
          return
        }

        if (oldDoc && oldDoc.type !== newDoc.type) {
          log('bad notification update 1')
          throw({forbidden: `Bad notification update 1: ${newDoc._id}, ${sourceUserID}`});
        }
        if (!newDoc.type || newDoc.type !== 'notification') {
          log('bad notification update 2')
          throw({forbidden: `Bad notification doc update 2: ${newDoc._id}, ${sourceUserID}`});
        }

        if (sourceUserID !== newDoc.userID) {
          log(`Bad notification doc update 3: ${newDoc._id}, ${sourceUserID}`)
          throw({forbidden: `Bad notification doc update 3: ${newDoc._id}, ${sourceUserID}`});
        }
      }.toString(),
      views: {
        types: {
          map: function (doc) {
            emit(doc.type, null)
          }.toString(),
          reduce: '_count'
        },
      },
      filters: {
        byUserIDs: function (doc, req) {
          return doc.type === 'notification' && doc.userID === req.query.ownUserID && doc.seen !== true
        }.toString(),
      }
    })
  })
}
