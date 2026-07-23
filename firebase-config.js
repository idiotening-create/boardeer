// ⚠️ 이 파일은 본인의 Firebase 프로젝트 설정으로 교체된 상태입니다.

const firebaseConfig = {
  apiKey: "AIzaSyDm4rHJzhHphngwfcw8ZKfXTrke4dcSa24",
  authDomain: "boardeer.firebaseapp.com",
  projectId: "boardeer",
  storageBucket: "boardeer.firebasestorage.app",
  messagingSenderId: "857930549497",
  appId: "1:857930549497:web:95c5836d19b181e8a87a28"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// 아직 실제 값으로 안 바꾸고 자리표시자가 남아있는지 확인
const FIREBASE_NOT_CONFIGURED = firebaseConfig.apiKey.includes('여기에');
