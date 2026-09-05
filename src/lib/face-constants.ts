export const FACE_EMBEDDING_DIM = 256;
export const FACE_MIN_EMBEDDINGS = 3;
export const FACE_MAX_EMBEDDINGS = 5;
// 모델이 바뀌면 이전 임베딩과 비교가 불가능하므로 버전을 올려 재등록을 유도한다.
// FaceRes(1024차원)는 나이·성별 헤드와 특징을 공유해 타인 간 유사도가 0.5~0.7까지 올라가 식별용으로 부적합했다.
export const FACE_MODEL_VERSION = "insightface-mobilenet-emore@human3.3.6";
export const FACE_MODEL_PATH = "insightface-mobilenet-emore.json";
export const DEFAULT_FACE_MATCH_THRESHOLD = 0.45;
export const DEFAULT_FACE_MATCH_MARGIN = 0.05;
