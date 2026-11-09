// Star-ring motif: one remitter, >=3 distinct beneficiary accounts that share a phone/device
// fingerprint (MRGL via Record->Phone/Device.h, partner banks via Account-HAS_FP->Fingerprint.fp),
// all transfers within 72 hours. Returns the ring as a list of paths.
MATCH (rm:Remitter)-[:SENT]->(t:Transfer)-[:TO]->(a:Account)
CALL {
  WITH a
  MATCH (a)<-[:HOLDS]-(:Record)-[:USES_PHONE|USES_DEVICE]->(x)
  RETURN x.h AS k
  UNION
  WITH a
  MATCH (a)-[:HAS_FP]->(f:Fingerprint) WHERE f.kind IN ['phone', 'device']
  RETURN f.fp AS k
}
WITH rm, k, collect(DISTINCT a) AS accts, collect(DISTINCT t) AS txs
WHERE size(accts) >= 3
  AND duration.inSeconds(apoc.coll.min([x IN txs | x.ts]), apoc.coll.max([x IN txs | x.ts])).hours <= 72
UNWIND txs AS t
MATCH p = (rm)-[:SENT]->(t)-[:TO]->(a:Account) WHERE a IN accts
WITH rm, k, accts, collect(p) AS paths
RETURN rm.rmid AS remitter, left(k, 16) AS shared_fp, size(accts) AS beneficiaries,
       apoc.coll.toSet([a IN accts | a.bank]) AS banks, paths
ORDER BY beneficiaries DESC;
