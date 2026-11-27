class TAbstractFile {}
class TFile extends TAbstractFile {
  constructor(path, mtime) {
    super();
    this.path = path;
    this.basename = path.split("/").pop().replace(/\.[^.]+$/, "");
    this.extension = path.includes(".") ? path.split(".").pop() : "";
    this.stat = { mtime: mtime || 1 };
  }
}
class TFolder extends TAbstractFile {
  constructor(path) {
    super();
    this.path = path;
  }
}
function normalizePath(p) {
  return p.replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}
module.exports = { TFile, TFolder, normalizePath };
