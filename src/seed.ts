/**
 * seed — sample drops clustered near a known coordinate, so the nearby/reveal
 * flow has something to find during manual testing. Idempotent-ish: it clears
 * the seed device's drops first, then re-inserts.
 *
 * Run: `yarn db:seed`. The seed device id is printed so you can use it (or any
 * other X-Device-Id) to query.
 */
import { sqlClient, closeDb } from './db/client.js';
import { deviceRepo } from './repositories/device.repo.js';
import { dropRepo } from './repositories/drop.repo.js';
import type { Mood } from './domain/clientTypes.js';

const SEED_DEVICE = '00000000-0000-4000-8000-000000000000';

// Centre point: MG Road, Bengaluru. Offsets are a few tens of metres apart.
const CENTRE = { lat: 12.9756, lng: 77.6094 };

const samples: { body: string; mood: Mood; dLat: number; dLng: number; placeLabel: string }[] =
  [
    {
      body: 'I waited here for someone who never came. I still look for them in crowds.',
      mood: 'ache',
      dLat: 0.0,
      dLng: 0.0,
      placeLabel: 'MG Road',
    },
    {
      body: 'Got the job right on this bench. I called my mum and cried into the phone.',
      mood: 'joy',
      dLat: 0.0002,
      dLng: 0.0001,
      placeLabel: 'Brigade Road corner',
    },
    {
      body: 'I lied to my best friend here and I have never told anyone since.',
      mood: 'trouble',
      dLat: -0.00015,
      dLng: 0.00018,
      placeLabel: 'Church Street',
    },
    {
      body: 'A stranger paid for my coffee and disappeared. I think about them every day.',
      mood: 'wonder',
      dLat: 0.00025,
      dLng: -0.0002,
      placeLabel: 'Blue Tokai',
    },
  ];

async function main(): Promise<void> {
  await deviceRepo.ensure(SEED_DEVICE);
  await sqlClient`DELETE FROM drops WHERE device_id = ${SEED_DEVICE}`;

  for (const s of samples) {
    await dropRepo.create({
      deviceId: SEED_DEVICE,
      body: s.body,
      mood: s.mood,
      placeLabel: s.placeLabel,
      city: 'Bengaluru',
      coordinate: { lat: CENTRE.lat + s.dLat, lng: CENTRE.lng + s.dLng },
      status: 'visible',
    });
  }

  console.log(`Seeded ${samples.length} drops near ${CENTRE.lat},${CENTRE.lng}.`);
  console.log(`Seed device id: ${SEED_DEVICE}`);
  console.log(
    `Try: GET /drops/nearby?lat=${CENTRE.lat}&lng=${CENTRE.lng}  (with any X-Device-Id)`,
  );
  await closeDb();
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
