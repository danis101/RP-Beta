import { getToken } from '../services/sync/client'
import { createImageGenerator } from '../../../shared/llm/imageGen'
export type { ImageGenResult } from '../../../shared/llm/imageGen'
export const generateImage = createImageGenerator(getToken, (...args) => fetch(...args))
