(() => {
  "use strict";

  window.createSakiPoseBlend = (motion, lattice) => {
    const {x: columns, y: rows, unitsPerPixel} = motion;
    const gridSize = rows.length * columns.length;
    const vectors = Int8Array.from(atob(motion.fields), byte => byte.charCodeAt(0));
    const side = lattice.steps + 1;
    const buffer = document.createElement("canvas");
    buffer.width = lattice.width;
    buffer.height = lattice.cut;
    const paint = buffer.getContext("2d");
    const original = new Float32Array(gridSize * 2);
    const moved = new Float32Array(original.length);

    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < columns.length; i++) {
        const vertex = 2 * (j * columns.length + i);
        original[vertex] = columns[i];
        original[vertex + 1] = rows[j];
      }
    }
    function makeTriangles(step) {
      const triangles = [];
      for (let j = 0; j < rows.length - 1; j += step) {
        const bottomRow = Math.min(j + step, rows.length - 1);
        for (let i = 0; i < columns.length - 1; i += step) {
          const rightColumn = Math.min(i + step, columns.length - 1);
          const p = 2 * (j * columns.length + i);
          const right = 2 * (rightColumn - i);
          const q = 2 * (bottomRow * columns.length + i);
          const left = Math.max(0, columns[i] - 3);
          const top = Math.max(0, rows[j] - 3);
          const width = Math.min(lattice.width, columns[rightColumn] + 3) - left;
          const height = Math.min(lattice.cut, rows[bottomRow] + 3) - top;
          triangles.push([p, p + right, q, left, top, width, height]);
          triangles.push([q + right, q, p + right, left, top, width, height]);
        }
      }
      return triangles;
    }
    const triangles = makeTriangles(1);
    const compactTriangles = makeTriangles(2);

    function triangle(source, [p, q, r, left, top, width, height]) {
      const x = moved[p], y = moved[p + 1];
      const qx = moved[q], qy = moved[q + 1], rx = moved[r], ry = moved[r + 1];
      const invW = 1 / (original[q] - original[p]);
      const invH = 1 / (original[r + 1] - original[p + 1]);
      const a = (qx - x) * invW, b = (qy - y) * invW;
      const c = (rx - x) * invH, d = (ry - y) * invH;
      const sourceX = original[p], sourceY = original[p + 1];

      // Cover the antialias fringe with both neighbors along shared edges.
      const padX = Math.sign(invW) * 1.25, padY = Math.sign(invH) * 1.25;
      paint.save();
      paint.beginPath();
      paint.moveTo(x - padX, y - padY);
      paint.lineTo(qx + 2 * padX, qy - padY);
      paint.lineTo(rx - padX, ry + 2 * padY);
      paint.closePath();
      paint.clip();
      paint.transform(a, b, c, d, x - a * sourceX - c * sourceY, y - b * sourceX - d * sourceY);
      paint.drawImage(source, left, top, width, height, left, top, width, height);
      paint.restore();
    }

    function warp(source, pose, compact = false) {
      if (Math.abs(pose.dx) + Math.abs(pose.dy) < .023) return source;
      const {index, dx, dy} = pose;
      const first = index * original.length * 4;
      const horizontal = first + (dx < 0 ? 0 : original.length);
      const vertical = first + (dy < 0 ? 2 : 3) * original.length;
      const weightX = Math.abs(dx) / unitsPerPixel;
      const weightY = Math.abs(dy) / unitsPerPixel;
      for (let i = 0; i < original.length; i++) {
        moved[i] = original[i] + weightX * vectors[horizontal + i] + weightY * vectors[vertical + i];
      }
      return drawMesh(source, compact);
    }

    function drawMesh(source, compact) {
      paint.clearRect(0, 0, buffer.width, buffer.height);
      for (const shape of compact ? compactTriangles : triangles) triangle(source, shape);
      return buffer;
    }

    function roll(source, degrees, compact = false) {
      if (Math.abs(degrees) < .08) return source;
      const angle = degrees * Math.PI / 180;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      const pivotX = lattice.width * .5, pivotY = 267;
      for (let i = 0; i < original.length; i += 2) {
        const x = original[i], y = original[i + 1];
        const horizontal = Math.min(1, x / 95, (lattice.width - x) / 95);
        const t = Math.max(0, Math.min(1, (y - 240) / 112));
        const weight = horizontal * (1 - t * t * (3 - 2 * t));
        const dx = x - pivotX, dy = y - pivotY;
        moved[i] = x + ((cos - 1) * dx - sin * dy) * weight;
        moved[i + 1] = y + (sin * dx + (cos - 1) * dy) * weight;
      }
      return drawMesh(source, compact);
    }
    return {warp,roll};
  };
})();
