export default function startUsersChangeIterator (ESClient, slouch) {
  // @TODO: this is going to have to change when there are
  // a ton of changes, or it will be loading them all every
  // time the backend boots.
  let iterator = slouch.db.changes('users', {
    include_docs: true,
    feed: 'continuous',
    heartbeat: true,
  })

  iterator.each(async (item) => {
    if (item.doc && item.doc.type === 'user') {
      console.log('updating elasticsearch record: ' + item.doc._id)
      await ESClient.update({
        index: 'users',
        type: 'users',
        body: {
          doc: {
            firstName: item.doc.firstName,
            lastName: item.doc.lastName,
            profilePhotoID: item.doc.profilePhotoID,
            photosByID: item.doc.photosByID,
            aboutMe: item.doc.aboutMe,
          },
          doc_as_upsert: true,
        },
        id: item.doc._id,
      })
    }
    if (item.deleted) {
      try {
        await ESClient.delete({
          index: 'users',
          type: 'users',
          id: item.doc._id
        })
        console.log('deleting elasticsearch record: ' + item.doc._id)
      } catch (e) {}
    }
    return Promise.resolve()
  })
}
