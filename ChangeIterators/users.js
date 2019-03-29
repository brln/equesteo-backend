import { USERS_DB, USERS_DESIGN_DOC } from "../design_docs/users"
import Logging from '../services/Logging'

export default function startUsersChangeIterator (ESClient, slouch) {
  slouch.db.view(USERS_DB, USERS_DESIGN_DOC, 'byID', {include_docs: true}).each(item => {
    if (item.deleted !== true) {
      let profilePhotoURL
      return slouch.doc.get(USERS_DB, item.doc.profilePhotoID).then((profilePhoto) => {
        profilePhotoURL = profilePhoto.uri
      }).catch(() => {}).then(() => {
        return ESClient.update({
          index: 'users',
          type: 'users',
          body: {
            doc: {
              firstName: item.doc.firstName,
              lastName: item.doc.lastName,
              profilePhotoURL,
              aboutMe: item.doc.aboutMe,
            },
            doc_as_upsert: true,
          },
          id: item.doc._id,
        })
      })
    }
  }).then(() => {
    Logging.log('initial User elastic record update complete')
    let iterator = slouch.db.changes('users', {
      include_docs: true,
      feed: 'continuous',
      heartbeat: true,
      since: 'now'
    })

    iterator.each((item) => {
      if (item.doc && item.doc.type === 'user' && item.doc.deleted !== true) {
        let profilePhotoURL
        return slouch.doc.get(USERS_DB, item.doc.profilePhotoID).then((profilePhoto) => {
          profilePhotoURL = profilePhoto.uri
        }).catch(() => {}).then(() => {
          Logging.log('updating elasticsearch record: ' + item.doc._id)
          return ESClient.update({
            index: 'users',
            type: 'users',
            body: {
              doc: {
                firstName: item.doc.firstName,
                lastName: item.doc.lastName,
                profilePhotoURL,
                aboutMe: item.doc.aboutMe,
              },
              doc_as_upsert: true,
            },
            id: item.doc._id,
          })
        })
      } else if (item.doc && item.doc.type === 'user') {
        Logging.log('deleting elasticsearch record: ' + item.doc._id)
        return ESClient.delete({
          index: 'users',
          type: 'users',
          id: item.doc._id
        })

      }
    })
  }).catch(e => {
    Logging.log(e)
  })
}
