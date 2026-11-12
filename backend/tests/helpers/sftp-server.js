/**
 * A small in-process SFTP server over ssh2, serving one folder, for tests of
 * the application backup's off-host copy. Password or public-key login for one
 * user; enough of SFTP v3 for open/write/read/close, stat, readdir, rename and
 * remove. Paths are resolved inside `root` (".." can't leave it).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server, utils } = require('ssh2');

const { OPEN_MODE, STATUS_CODE } = utils.sftp;

function startSftpServer({ root, username = 'backup', password = 'secret-pass', publicKey = null, hostKey = null } = {}) {
  const key = hostKey || utils.generateKeyPairSync('ed25519').private;
  const allowedKey = publicKey ? utils.parseKey(publicKey) : null;
  const stats = { logins: 0, writes: 0 };

  const inside = (p) => {
    const full = path.resolve(root, `./${path.posix.normalize(`/${p || '.'}`)}`);
    return full.startsWith(path.resolve(root)) ? full : null;
  };
  const attrsOf = (st) => ({
    mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
    atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000),
  });

  const server = new Server({ hostKeys: [key] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username !== username) return ctx.reject();
      if (ctx.method === 'password' && password && ctx.password === password) return ctx.accept();
      if (ctx.method === 'publickey' && allowedKey
        && ctx.key.algo === allowedKey.type
        && ctx.key.data.equals(allowedKey.getPublicSSH())) {
        if (!ctx.signature) return ctx.accept();
        if (allowedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
      }
      return ctx.reject();
    });
    client.on('ready', () => {
      stats.logins += 1;
      client.setNoDelay(true);
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp();
          const handles = new Map();
          let next = 0;
          const newHandle = (value) => {
            const h = Buffer.alloc(4);
            h.writeUInt32BE(next++, 0);
            handles.set(h.toString('hex'), value);
            return h;
          };
          const fail = (reqid, error) => sftp.status(reqid, error?.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE
            : error?.code === 'EACCES' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE);

          sftp.on('OPEN', (reqid, filename, flags) => {
            const full = inside(filename);
            if (!full) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            const mode = (flags & OPEN_MODE.WRITE) ? ((flags & OPEN_MODE.APPEND) ? 'a' : 'w') : 'r';
            try {
              return sftp.handle(reqid, newHandle({ fd: fs.openSync(full, mode) }));
            } catch (error) {
              return fail(reqid, error);
            }
          });
          sftp.on('WRITE', (reqid, handle, offset, data) => {
            const h = handles.get(handle.toString('hex'));
            if (!h?.fd && h?.fd !== 0) return sftp.status(reqid, STATUS_CODE.FAILURE);
            fs.writeSync(h.fd, data, 0, data.length, offset);
            stats.writes += 1;
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          sftp.on('READ', (reqid, handle, offset, length) => {
            const h = handles.get(handle.toString('hex'));
            const buf = Buffer.alloc(length);
            const n = fs.readSync(h.fd, buf, 0, length, offset);
            return n ? sftp.data(reqid, buf.subarray(0, n)) : sftp.status(reqid, STATUS_CODE.EOF);
          });
          sftp.on('FSTAT', (reqid, handle) => {
            const h = handles.get(handle.toString('hex'));
            return sftp.attrs(reqid, attrsOf(fs.fstatSync(h.fd)));
          });
          sftp.on('CLOSE', (reqid, handle) => {
            const id = handle.toString('hex');
            const h = handles.get(id);
            if (h?.fd !== undefined) fs.closeSync(h.fd);
            handles.delete(id);
            return sftp.status(reqid, STATUS_CODE.OK);
          });
          const statHandler = (reqid, p) => {
            const full = inside(p);
            try {
              return sftp.attrs(reqid, attrsOf(fs.statSync(full)));
            } catch (error) {
              return fail(reqid, error);
            }
          };
          sftp.on('STAT', statHandler);
          sftp.on('LSTAT', statHandler);
          sftp.on('OPENDIR', (reqid, p) => {
            const full = inside(p);
            try {
              const names = fs.readdirSync(full);
              return sftp.handle(reqid, newHandle({ dir: full, names, done: false }));
            } catch (error) {
              return fail(reqid, error);
            }
          });
          sftp.on('READDIR', (reqid, handle) => {
            const h = handles.get(handle.toString('hex'));
            if (!h || h.done) return sftp.status(reqid, STATUS_CODE.EOF);
            h.done = true;
            return sftp.name(reqid, h.names.map((filename) => ({
              filename, longname: filename, attrs: attrsOf(fs.statSync(path.join(h.dir, filename))),
            })));
          });
          sftp.on('REMOVE', (reqid, p) => {
            try {
              fs.unlinkSync(inside(p));
              return sftp.status(reqid, STATUS_CODE.OK);
            } catch (error) {
              return fail(reqid, error);
            }
          });
          sftp.on('RENAME', (reqid, from, to) => {
            const target = inside(to);
            // SFTP v3: an existing target is an error
            if (fs.existsSync(target)) return sftp.status(reqid, STATUS_CODE.FAILURE);
            try {
              fs.renameSync(inside(from), target);
              return sftp.status(reqid, STATUS_CODE.OK);
            } catch (error) {
              return fail(reqid, error);
            }
          });
          sftp.on('REALPATH', (reqid, p) => sftp.name(reqid, [{ filename: path.posix.normalize(`/${p}`), longname: '', attrs: {} }]));
        });
      });
    });
    client.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const parsed = utils.parseKey(key);
      const fingerprint = `SHA256:${crypto.createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
      resolve({
        port: server.address().port,
        fingerprint,
        stats,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

module.exports = { startSftpServer };
