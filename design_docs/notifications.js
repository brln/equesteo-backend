export const NOTIFICATIONS_DB = 'notifications'
export const NOTIFICATIONS_DESIGN_DOC = '_design/notifications'

export function createNotificationsDesignDoc (slouch) {
  slouch.db.create(NOTIFICATIONS_DB).then(() => {
    slouch.doc.createOrUpdate(NOTIFICATIONS_DB, {
      _id: NOTIFICATIONS_DESIGN_DOC,
      filters: {
        byUserIDs: function (doc, req) {
          return doc.type === 'notification' && doc.userID === req.query.ownUserID && doc.seen !== true
        }.toString(),
      }
    })
  })
}
