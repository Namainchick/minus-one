/** Job-IDs: Replicate-Prediction-IDs oder Mock-IDs — nur harmlose Zeichen erlaubt (Schutz vor Pfad-Tricks). */
export function isValidJobId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}
