import { CacheFile, CacheItemType, CacheItemTypeKey, CacheRequest } from '@app/models/music'
import { mkdir, rmdir } from '@app/util/fs'
import PromiseQueue from '@app/util/PromiseQueue'
import produce from 'immer'
import RNFS from 'react-native-fs'
import { GetState, SetState } from 'zustand'
import { Store } from './store'

const imageDownloadQueue = new PromiseQueue(20)
const songDownloadQueue = new PromiseQueue(1)

export type CacheDownload = CacheFile & CacheRequest

export type CacheDirsByServer = Record<string, Record<CacheItemTypeKey, string>>
export type CacheFilesByServer = Record<string, Record<CacheItemTypeKey, Record<string, CacheFile>>>
export type CacheRequestsByServer = Record<string, Record<CacheItemTypeKey, Record<string, CacheRequest>>>

// export type DownloadedItemsByServer = Record<
//   string,
//   {
//     songs: { [songId: string]: DownloadedSong }
//     albums: { [albumId: string]: DownloadedAlbum }
//     artists: { [songId: string]: DownloadedArtist }
//     playlists: { [playlistId: string]: DownloadedPlaylist }
//   }
// >

export type CacheSlice = {
  cacheItem: (key: CacheItemTypeKey, itemId: string, url: string | (() => string | Promise<string>)) => Promise<void>

  // cache: DownloadedItemsByServer
  cacheDirs: CacheDirsByServer
  cacheFiles: CacheFilesByServer
  cacheRequests: CacheRequestsByServer

  fetchCoverArtFilePath: (coverArt: string) => Promise<string | undefined>

  createCache: (serverId: string) => Promise<void>
  prepareCache: (serverId: string) => void
  pendingRemoval: Record<string, boolean>
  removeCache: (serverId: string) => Promise<void>
}

export const selectCache = {
  cacheItem: (store: CacheSlice) => store.cacheItem,
  fetchCoverArtFilePath: (store: CacheSlice) => store.fetchCoverArtFilePath,

  songCacheDir: (store: Store) => {
    const activeServerId = store.settings.activeServer
    if (!activeServerId) {
      return
    }

    return store.cacheDirs[activeServerId].song
  },
}

export const createCacheSlice = (set: SetState<Store>, get: GetState<Store>): CacheSlice => ({
  // cache: {},
  cacheDirs: {},
  cacheFiles: {},
  cacheRequests: {},

  cacheItem: async (key, itemId, url) => {
    const client = get().client
    if (!client) {
      return
    }

    const activeServerId = get().settings.activeServer
    if (!activeServerId) {
      return
    }

    if (get().pendingRemoval[activeServerId]) {
      return
    }

    const inProgress = get().cacheRequests[activeServerId][key][itemId]
    if (inProgress && inProgress.promise !== undefined) {
      return await inProgress.promise
    }

    const existing = get().cacheFiles[activeServerId][key][itemId]
    if (existing) {
      return
    }

    const path = `${get().cacheDirs[activeServerId][key]}/${itemId}`
    const urlResult = typeof url === 'string' ? url : url()
    const fromUrl = typeof urlResult === 'string' ? urlResult : await urlResult

    const queue = key === 'song' ? songDownloadQueue : imageDownloadQueue

    const promise = queue.enqueue(() =>
      RNFS.downloadFile({
        fromUrl,
        toFile: path,
        progressInterval: 100,
        progress: res => {
          set(
            produce<CacheSlice>(state => {
              state.cacheRequests[activeServerId][key][itemId].progress = Math.max(
                1,
                res.bytesWritten / (res.contentLength || 1),
              )
            }),
          )
        },
      })
        .promise.then(() => {
          set(
            produce<CacheSlice>(state => {
              state.cacheRequests[activeServerId][key][itemId].progress = 1
              delete state.cacheRequests[activeServerId][key][itemId].promise
            }),
          )
        })
        .catch(() => {
          set(
            produce<CacheSlice>(state => {
              delete state.cacheFiles[activeServerId][key][itemId]
              delete state.cacheRequests[activeServerId][key][itemId]
            }),
          )
        }),
    )
    set(
      produce<Store>(state => {
        state.cacheFiles[activeServerId][key][itemId] = {
          path,
          date: Date.now(),
          permanent: false,
        }
        state.cacheRequests[activeServerId][key][itemId] = {
          progress: 0,
          promise,
        }
      }),
    )
    return await promise
  },

  fetchCoverArtFilePath: async coverArt => {
    const client = get().client
    if (!client) {
      return
    }

    const activeServerId = get().settings.activeServer
    if (!activeServerId) {
      return
    }

    const existing = get().cacheFiles[activeServerId].coverArt[coverArt]
    const inProgress = get().cacheRequests[activeServerId].coverArt[coverArt]
    if (existing && inProgress) {
      if (inProgress.promise) {
        await inProgress.promise
      }
      return existing.path
    }

    await get().cacheItem('coverArt', coverArt, () => client.getCoverArtUri({ id: coverArt }))
    return `file://${get().cacheFiles[activeServerId].coverArt[coverArt].path}`
  },

  createCache: async serverId => {
    for (const type in CacheItemType) {
      await mkdir(`${RNFS.DocumentDirectoryPath}/servers/${serverId}/${type}`)
    }

    set(
      produce<CacheSlice>(state => {
        state.cacheFiles[serverId] = {
          song: {},
          coverArt: {},
          artistArt: {},
        }
      }),
    )

    get().prepareCache(serverId)
  },

  prepareCache: serverId => {
    set(
      produce<CacheSlice>(state => {
        if (!state.cacheDirs[serverId]) {
          state.cacheDirs[serverId] = {
            song: `${RNFS.DocumentDirectoryPath}/servers/${serverId}/song`,
            coverArt: `${RNFS.DocumentDirectoryPath}/servers/${serverId}/coverArt`,
            artistArt: `${RNFS.DocumentDirectoryPath}/servers/${serverId}/artistArt`,
          }
        }
        if (!state.cacheRequests[serverId]) {
          state.cacheRequests[serverId] = {
            song: {},
            coverArt: {},
            artistArt: {},
          }
        }
      }),
    )
  },

  pendingRemoval: {},

  removeCache: async serverId => {
    set(
      produce<CacheSlice>(state => {
        state.pendingRemoval[serverId] = true
      }),
    )

    const cacheRequests = get().cacheRequests[serverId]
    const pendingRequests: Promise<void>[] = []

    for (const type in CacheItemType) {
      const requests = Object.values(cacheRequests[type as CacheItemTypeKey])
        .filter(r => r.promise !== undefined)
        .map(r => r.promise) as Promise<void>[]
      pendingRequests.push(...requests)
    }

    await Promise.all(pendingRequests)
    await rmdir(`${RNFS.DocumentDirectoryPath}/servers/${serverId}`)

    set(
      produce<CacheSlice>(state => {
        delete state.pendingRemoval[serverId]

        if (state.cacheDirs[serverId]) {
          delete state.cacheDirs[serverId]
        }
        if (state.cacheFiles[serverId]) {
          delete state.cacheFiles[serverId]
        }
        if (state.cacheRequests[serverId]) {
          delete state.cacheRequests[serverId]
        }
      }),
    )
  },
})
