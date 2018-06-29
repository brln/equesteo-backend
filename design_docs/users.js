export const USERS_DB = 'users'
export const USERS_DESIGN_DOC = '_design/users'

export function createUsersDesignDoc (slouch) {
  slouch.db.create(USERS_DB).then(() => {
    slouch.doc.createOrUpdate(USERS_DB, {
      _id: USERS_DESIGN_DOC,
      views: {
        by_email: {
          map: function (doc) { emit(doc.email, doc.password); }.toString()
        },
        followers: {
          map: function (doc) {
            if( doc.following.length > 0 ) {
              for(let i = 0; i < doc.following.length ; i++) {
                emit( doc.following[i], doc._id );
              }
            }
          }.toString()
        }
      }
    })
  })
}

