/** Chunk-ring distance from the active camera's canonical chunk. */
export function createCameraChunkDistance(camera, origin, chunkWorldSize) {
  const cameraChunkX = Math.floor((camera.position.x + origin.x) / chunkWorldSize);
  const cameraChunkZ = Math.floor(-(camera.position.z + origin.z) / chunkWorldSize);
  return (chunkX, chunkZ) => Math.max(
    Math.abs(chunkX - cameraChunkX),
    Math.abs(chunkZ - cameraChunkZ),
  );
}
