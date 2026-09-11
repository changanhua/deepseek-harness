export class EventEmitter {
  on() {}
  off() {}
  emit() {}
}

export const BidiServer = {
  async createAndStart() {
    throw new Error('WebDriver BiDi is unavailable in the browser-extension Puppeteer bundle')
  },
}
