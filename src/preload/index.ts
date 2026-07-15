import { contextBridge } from 'electron';
import { bureauApi } from './api';

contextBridge.exposeInMainWorld('bureau', bureauApi);
