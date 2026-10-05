// The crypto worker: the only place the account key lives (PLAN.md §10.6).
import * as Comlink from 'comlink'
import { indexedDbDeviceStore } from './device-store'
import { Keyring } from './keyring'

Comlink.expose(new Keyring(indexedDbDeviceStore()))
