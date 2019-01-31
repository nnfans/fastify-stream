'use strict'

const fp = require('fastify-plugin')
const fs = require('fs')
const exts = require('./lib/exts')
const pathModule = require('path')

function pipeStream (fastify, opts, done) {
  let shared = {}

  // Get file size function
  const fileSizeInfo = function (path) {
    if (path) {
      if (!exports.noCache && shared[path]) {
        return shared[path]
      } else {
        if (!fs.existsSync(path)) {
          return null
        }
        var stat = fs.statSync(path)
        if (!exports.noCache) { shared[path] = stat.size }

        return stat.size
      }
    }
    return 0
  }

  // set this to true for development mode
  exports.noCache = false
  exports.mediaTypes = exts

  // Get file range request
  const getFileRange = function (req, total) {
    const reqInfo = req.headers ? req.headers.range : null
    let result = [0, total, 0]

    if (reqInfo) {
      const reqLoc = reqInfo.indexOf('bytes=')
      if (reqLoc >= 0) {
        const ranges = reqInfo.substr(reqLoc + 6).split('-')
        try {
          result[0] = parseInt(ranges[0])
          if (ranges[1] && ranges[1].length) {
            result[1] = parseInt(ranges[1])
            result[1] = result[1] < 16 ? 16 : result[1]
          }
        } catch (e) {}
      }

      if (result[1] === total) { result[1]-- }

      result[2] = total
    }

    return result
  }

  const isString = function (str) {
    if (!str) return false
    return (typeof str === 'string' || str instanceof String)
  }

  const pipe = function (req, rep, path, type, optCb) {
    if (!isString(path)) {
      throw new TypeError('path must be a string value')
    }

    const res = rep.res
    const total = fileSizeInfo(path)

    if (total == null) {
      res.end(path + ' not found')
      return false
    }

    const range = getFileRange(req, total)

    let ext = pathModule.extname(path).toLowerCase()
    if (!type && ext && ext.length) {
      type = exts[ext]
    }

    if (type && type.length && type[0] === '.') {
      ext = type
      type = exts[type]
    }

    if (!type || !type.length) {
      res.write('Media format not found for ' + pathModule.basename(path))
    } else {
      const file = fs.createReadStream(path, { start: range[0], end: range[1] })

      const cleanupFileStream = function () {
        file.close()
      }

      // the event emitted seems to change based on version of node.js
      // 'close' is fired as of v6.11.5
      res.on('close', cleanupFileStream)
      res.on('end', cleanupFileStream)
      res.on('finish', cleanupFileStream)

      if (!ext.length) {
        let header = {
          'Content-Length': range[1],
          'Content-Type': type,
          'Access-Control-Allow-Origin': req.headers.origin || '*',
          'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'POST, GET, OPTIONS'
        }

        if (range[2]) {
          header['Accept-Ranges'] = 'bytes'
          header['Content-Range'] = 'bytes ' + range[0] + '-' + range[1] + '/' + total
          header['Content-Length'] = range[2]

          res.writeHead(206, header)
        } else {
          res.writeHead(200, header)
        }

        file.pipe(res)
        file.on('close', function () {
          res.end(0)
          if (optCb && typeof optCb === 'function') {
            optCb(path)
          }
        })
      } else {
        res.writeHead(200,
          {
            'Content-Type': type,
            'Access-Control-Allow-Origin': req.headers.origin || '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'POST, GET, OPTIONS'
          })
      }

      return true
    }

    return false
  }

  fastify.decorate('pipe', pipe)
  done()
}

module.exports = fp(pipeStream, {
  fastify: '>=1.0.0',
  name: 'fastify-stream'
})
