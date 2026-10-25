import React, { useState, useEffect, useRef, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, collection, addDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';

// --- Environment & Firebase Setup ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'local-test-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  // Mock config for safety if outside environment
};

let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("Firebase init error:", e);
}

// --- Constants & Themes ---
const BOARD_THEMES = {
  classic: { light: 'bg-[#f0d9b5]', dark: 'bg-[#b58863]', name: 'Clássico' },
  ocean: { light: 'bg-[#e0f7fa]', dark: 'bg-[#006064]', name: 'Oceano' },
  midnight: { light: 'bg-[#9e9e9e]', dark: 'bg-[#212121]', name: 'Meia-noite' }
};

const CHESS_PIECES = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};

// Checkers Board Setup
const INITIAL_CHECKERS = [
  [0, 3, 0, 3, 0, 3, 0, 3],
  [3, 0, 3, 0, 3, 0, 3, 0],
  [0, 3, 0, 3, 0, 3, 0, 3],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 1, 0],
  [0, 1, 0, 1, 0, 1, 0, 1],
  [1, 0, 1, 0, 1, 0, 1, 0]
];
// 1 = P1 (Red), 2 = P1 King, 3 = P2 (Black), 4 = P2 King

// --- Main Application Component ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState('menu'); // 'menu', 'room'
  const [roomData, setRoomData] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Authentication
  useEffect(() => {
    const authenticate = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth Error:", err);
        setErrorMsg("Falha na autenticação. Tente novamente.");
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        setAuthLoading(false);
      } else if (!authLoading) {
        authenticate();
      }
    });

    authenticate();
    return () => unsubscribe();
  }, []);

  const createRoom = async (gameType) => {
    if (!user) return;
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId);
    
    await setDoc(roomRef, {
      id: roomId,
      type: gameType,
      players: { p1: user.uid, p2: null },
      status: 'waiting',
      state: gameType === 'chess' ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : JSON.stringify(INITIAL_CHECKERS),
      turn: 'p1',
      createdAt: serverTimestamp()
    });
    
    setRoomData({ id: roomId, type: gameType, isCreator: true });
    setView('room');
  };

  const joinRoom = async (roomId) => {
    if (!user || !roomId) return;
    roomId = roomId.toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId);
    
    // Listen to room to see if it exists and join
    const unsub = onSnapshot(roomRef, async (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.players.p1 !== user.uid && !data.players.p2) {
          // Join as Player 2
          await updateDoc(roomRef, {
            'players.p2': user.uid,
            status: 'playing'
          });
          setRoomData({ id: roomId, type: data.type, isCreator: false });
          setView('room');
          unsub();
        } else if (data.players.p1 === user.uid || data.players.p2 === user.uid) {
          // Rejoin
          setRoomData({ id: roomId, type: data.type, isCreator: data.players.p1 === user.uid });
          setView('room');
          unsub();
        } else {
          setErrorMsg("Sala cheia ou indisponível.");
          setTimeout(() => setErrorMsg(''), 3000);
          unsub();
        }
      } else {
        setErrorMsg("Sala não encontrada.");
        setTimeout(() => setErrorMsg(''), 3000);
        unsub();
      }
    });
  };

  if (authLoading) return <LoadingScreen message="Conectando..." />;

  return (
    <div className="min-h-screen bg-neutral-900 text-white font-sans selection:bg-blue-500 selection:text-white">
      {errorMsg && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 px-6 py-3 rounded-xl shadow-2xl font-bold flex items-center gap-2 animate-bounce">
          <span>⚠️</span> {errorMsg}
        </div>
      )}
      
      {view === 'menu' ? (
        <MainMenu onCreate={createRoom} onJoin={joinRoom} user={user} />
      ) : (
        <GameRoom 
          roomData={roomData} 
          user={user} 
          onLeave={() => setView('menu')} 
        />
      )}
    </div>
  );
}

// --- Menu Component ---
function MainMenu({ onCreate, onJoin, user }) {
  const [joinId, setJoinId] = useState('');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-neutral-800 to-neutral-950">
      <div className="text-center mb-12 space-y-2">
        <h1 className="text-6xl font-extrabold tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500 drop-shadow-lg">
          BoardMaster Hub
        </h1>
        <p className="text-neutral-400 text-lg">Xadrez e Damas Profissional</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8 w-full max-w-4xl">
        {/* Create Game Section */}
        <div className="bg-neutral-800/50 backdrop-blur-md p-8 rounded-3xl border border-neutral-700 shadow-2xl flex flex-col items-center hover:border-neutral-500 transition-all">
          <h2 className="text-2xl font-bold mb-6">Criar Partida</h2>
          <div className="flex gap-4 w-full">
            <button 
              onClick={() => onCreate('chess')}
              className="flex-1 bg-gradient-to-br from-blue-600 to-blue-800 hover:from-blue-500 hover:to-blue-700 py-4 rounded-2xl font-bold shadow-lg transition-transform active:scale-95 flex flex-col items-center gap-2"
            >
              <span className="text-4xl">♔</span>
              Xadrez
            </button>
            <button 
              onClick={() => onCreate('checkers')}
              className="flex-1 bg-gradient-to-br from-red-600 to-red-800 hover:from-red-500 hover:to-red-700 py-4 rounded-2xl font-bold shadow-lg transition-transform active:scale-95 flex flex-col items-center gap-2"
            >
              <span className="text-4xl text-black drop-shadow-md">⛃</span>
              Damas
            </button>
          </div>
        </div>

        {/* Join Game Section */}
        <div className="bg-neutral-800/50 backdrop-blur-md p-8 rounded-3xl border border-neutral-700 shadow-2xl flex flex-col items-center hover:border-neutral-500 transition-all">
          <h2 className="text-2xl font-bold mb-6">Entrar em Partida</h2>
          <div className="w-full flex flex-col gap-4">
            <input 
              type="text" 
              placeholder="Código da Sala" 
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              className="w-full bg-neutral-900 border border-neutral-600 rounded-xl px-4 py-4 text-center text-2xl font-mono uppercase tracking-widest outline-none focus:border-blue-500 transition-colors"
              maxLength={6}
            />
            <button 
              onClick={() => onJoin(joinId)}
              disabled={joinId.length < 6}
              className="w-full bg-neutral-200 text-black hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed py-4 rounded-xl font-bold shadow-lg transition-transform active:scale-95"
            >
              Conectar
            </button>
          </div>
        </div>
      </div>
      
      <div className="mt-12 text-neutral-500 font-mono text-sm">
        ID do Jogador: {user?.uid.substring(0, 8)}
      </div>
    </div>
  );
}

// --- Game Room Wrapper ---
function GameRoom({ roomData, user, onLeave }) {
  const [gameState, setGameState] = useState(null);
  const [theme, setTheme] = useState('classic');
  const [players, setPlayers] = useState({ p1: null, p2: null });
  const [status, setStatus] = useState('waiting');
  const roomId = roomData.id;

  // Sync Game State
  useEffect(() => {
    if (!user) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId);
    
    const unsub = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setGameState(data.state);
        setPlayers(data.players);
        setStatus(data.status);
      }
    }, (err) => console.error("Room Sync Error:", err));

    return () => unsub();
  }, [roomId, user]);

  const updateGameState = async (newState, newTurn) => {
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', roomId);
    await updateDoc(roomRef, {
      state: newState,
      turn: newTurn
    });
  };

  const copyCode = () => {
    document.execCommand('copy');
    // Fallback for iframe environments to copy to clipboard
    const el = document.createElement('textarea');
    el.value = roomId;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  };

  return (
    <div className="flex flex-col lg:flex-row h-screen bg-neutral-950 p-2 lg:p-4 gap-4">
      {/* Left Column: The Game */}
      <div className="flex-1 bg-neutral-900 rounded-3xl border border-neutral-800 flex flex-col overflow-hidden shadow-2xl relative">
        {/* Header */}
        <div className="bg-neutral-800/80 backdrop-blur px-6 py-4 flex justify-between items-center border-b border-neutral-700">
          <div className="flex items-center gap-4">
            <button onClick={onLeave} className="text-neutral-400 hover:text-white transition-colors bg-neutral-700 hover:bg-neutral-600 w-10 h-10 rounded-full flex items-center justify-center shadow">
              ←
            </button>
            <div>
              <h2 className="font-bold text-xl capitalize flex items-center gap-2">
                {roomData.type === 'chess' ? 'Xadrez ♔' : 'Damas ⛃'} 
                <span className={`px-2 py-0.5 text-xs rounded-full ${status === 'playing' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                  {status === 'playing' ? 'Em andamento' : 'Aguardando'}
                </span>
              </h2>
              <div className="text-xs text-neutral-400 font-mono mt-1">Sala: {roomId}</div>
            </div>
          </div>

          <div className="flex gap-2">
             <button onClick={copyCode} className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-sm font-medium transition-colors">
              Copiar Código
            </button>
            <select 
              value={theme} 
              onChange={(e) => setTheme(e.target.value)}
              className="bg-neutral-700 border-none rounded-lg px-3 py-1.5 text-sm font-medium outline-none"
            >
              {Object.entries(BOARD_THEMES).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Board Area */}
        <div className="flex-1 flex items-center justify-center p-4 min-h-[400px]">
          {status === 'waiting' ? (
            <div className="text-center animate-pulse">
              <div className="text-6xl mb-4">⌛</div>
              <h3 className="text-2xl font-bold mb-2">Aguardando oponente...</h3>
              <p className="text-neutral-400">Compartilhe o código <strong className="text-white font-mono bg-neutral-800 px-2 py-1 rounded">{roomId}</strong></p>
            </div>
          ) : (
            roomData.type === 'chess' ? (
               <ChessBoard 
                  gameState={gameState} 
                  updateGameState={updateGameState} 
                  isCreator={roomData.isCreator} 
                  theme={BOARD_THEMES[theme]} 
                />
            ) : (
               <CheckersBoard 
                  gameState={gameState} 
                  updateGameState={updateGameState} 
                  isCreator={roomData.isCreator} 
                  theme={BOARD_THEMES[theme]} 
                />
            )
          )}
        </div>
      </div>

      {/* Right Column: Chat & Voice */}
      <div className="w-full lg:w-96 flex flex-col gap-4">
        {/* Voice Chat Panel */}
        <VoiceChat roomId={roomId} user={user} />
        
        {/* Text Chat Panel */}
        <TextChat roomId={roomId} user={user} />
      </div>
    </div>
  );
}

// --- Chess Logic & UI Component ---
function ChessBoard({ gameState, updateGameState, isCreator, theme }) {
  const [chess, setChess] = useState(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [possibleMoves, setPossibleMoves] = useState([]);
  
  // Load chess.js script dynamically
  useEffect(() => {
    if (window.Chess) {
      setChess(new window.Chess());
      setIsLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js";
    script.onload = () => {
      setChess(new window.Chess());
      setIsLoaded(true);
    };
    document.body.appendChild(script);
  }, []);

  // Force re-render after moves
  const [, setTick] = useState(0);
  const updateView = () => setTick(t => t + 1);

  // Sync local chess instance with Firebase state (FEN)
  useEffect(() => {
    if (isLoaded && chess && gameState && gameState !== chess.fen()) {
      try {
        chess.load(gameState);
        updateView();
      } catch (e) {
        console.error("Invalid FEN sync", e);
      }
    }
  }, [gameState, chess, isLoaded]);

  if (!isLoaded || !chess) {
    return <div className="text-white text-center p-8 animate-pulse">Carregando motor de xadrez...</div>;
  }

  const isMyTurn = () => {
    const turn = chess.turn(); // 'w' or 'b'
    return (isCreator && turn === 'w') || (!isCreator && turn === 'b');
  };

  const handleSquareClick = (square) => {
    if (!isMyTurn()) return; // Not your turn

    if (selectedSquare) {
      // Attempt move
      const move = possibleMoves.find(m => m.to === square);
      if (move) {
        chess.move({ from: move.from, to: move.to, promotion: 'q' });
        updateGameState(chess.fen(), chess.turn() === 'w' ? 'p1' : 'p2');
        setSelectedSquare(null);
        setPossibleMoves([]);
        updateView();
      } else {
        // Change selection
        const moves = chess.moves({ square, verbose: true });
        if (moves.length > 0) {
          setSelectedSquare(square);
          setPossibleMoves(moves);
        } else {
          setSelectedSquare(null);
          setPossibleMoves([]);
        }
      }
    } else {
      // Select piece
      const moves = chess.moves({ square, verbose: true });
      if (moves.length > 0) {
        setSelectedSquare(square);
        setPossibleMoves(moves);
      }
    }
  };

  const board = chess.board();
  const orientation = isCreator ? 'w' : 'b';
  
  // Rotate board if player is black
  const displayBoard = orientation === 'w' ? board : [...board].reverse().map(row => [...row].reverse());

  const getSquareName = (rowIndex, colIndex) => {
    const r = orientation === 'w' ? 7 - rowIndex : rowIndex;
    const c = orientation === 'w' ? colIndex : 7 - colIndex;
    const files = 'abcdefgh';
    return `${files[c]}${r + 1}`;
  };

  return (
    <div className="flex flex-col items-center">
      <div className="mb-4 text-lg font-bold flex items-center gap-2">
        {chess.in_checkmate() ? <span className="text-red-500">Xeque-mate!</span> :
         chess.in_draw() ? <span className="text-yellow-500">Empate!</span> :
         chess.in_check() ? <span className="text-orange-500 animate-pulse">Xeque!</span> :
         isMyTurn() ? <span className="text-green-400">Sua Vez</span> : 
         <span className="text-neutral-400">Vez do Oponente</span>}
      </div>
      
      <div className="inline-grid grid-cols-8 border-4 border-neutral-800 rounded-lg overflow-hidden shadow-2xl relative">
        {displayBoard.map((row, rowIndex) => 
          row.map((piece, colIndex) => {
            const squareName = getSquareName(rowIndex, colIndex);
            const isDark = (rowIndex + colIndex) % 2 === 1;
            const bgClass = isDark ? theme.dark : theme.light;
            const isSelected = selectedSquare === squareName;
            const isPossible = possibleMoves.some(m => m.to === squareName);
            
            return (
              <div 
                key={squareName}
                onClick={() => handleSquareClick(squareName)}
                className={`w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center text-3xl md:text-5xl cursor-pointer select-none transition-colors relative
                  ${bgClass} ${isSelected ? 'ring-inset ring-4 ring-yellow-400 bg-yellow-200/50 mix-blend-multiply' : ''}
                `}
              >
                {/* Possible move indicator */}
                {isPossible && !piece && <div className="absolute w-1/3 h-1/3 bg-black/20 rounded-full" />}
                {isPossible && piece && <div className="absolute w-full h-full border-4 border-black/20 rounded-full" />}
                
                {/* Piece Rendering */}
                {piece && (
                  <span className={`${piece.color === 'w' ? 'text-white drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]' : 'text-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]'} leading-none -mt-1`}
                        style={{ WebkitTextStroke: piece.color === 'w' ? '1px #000' : '0px' }}>
                    {CHESS_PIECES[piece.color][piece.type]}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- Checkers Logic & UI Component ---
function CheckersBoard({ gameState, updateGameState, isCreator, theme }) {
  const [board, setBoard] = useState(INITIAL_CHECKERS);
  const [turn, setTurn] = useState('p1'); // p1 = Red, p2 = Black
  const [selectedPos, setSelectedPos] = useState(null);
  const [validMoves, setValidMoves] = useState([]);

  // Sync state
  useEffect(() => {
    if (gameState) {
      try {
        const parsed = JSON.parse(gameState);
        setBoard(parsed.board || parsed); // Support older or wrapper formats
        if (parsed.turn) setTurn(parsed.turn);
      } catch (e) {
        console.error("Checkers parse error", e);
      }
    }
  }, [gameState]);

  const isMyTurn = (isCreator && turn === 'p1') || (!isCreator && turn === 'p2');
  const myPlayer = isCreator ? 1 : 3;

  // Simple Checkers Logic Engine (Single File Implementation)
  const getMoves = (r, c, b, player) => {
    const moves = [];
    const piece = b[r][c];
    if (piece === 0) return moves;
    
    const isKing = piece === 2 || piece === 4;
    const isRed = piece === 1 || piece === 2;
    const isBlack = piece === 3 || piece === 4;
    
    // Direction based on player
    const dirs = [];
    if (isRed || isKing) dirs.push([-1, -1], [-1, 1]); // Red moves UP (-1)
    if (isBlack || isKing) dirs.push([1, -1], [1, 1]);  // Black moves DOWN (+1)

    // Check regular moves and jumps
    dirs.forEach(([dr, dc]) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        if (b[nr][nc] === 0) {
          // Normal move
          moves.push({ toR: nr, toC: nc, jump: null });
        } else if ((isRed && (b[nr][nc] === 3 || b[nr][nc] === 4)) || 
                   (isBlack && (b[nr][nc] === 1 || b[nr][nc] === 2))) {
          // Enemy piece, check jump
          const jr = nr + dr, jc = nc + dc;
          if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 && b[jr][jc] === 0) {
            moves.push({ toR: jr, toC: jc, jump: {r: nr, c: nc} });
          }
        }
      }
    });
    return moves;
  };

  const handleSquareClick = (r, c) => {
    if (!isMyTurn) return;

    const piece = board[r][c];
    const isMyPiece = piece === myPlayer || piece === myPlayer + 1;

    if (selectedPos) {
      // Try to move
      const move = validMoves.find(m => m.toR === r && m.toC === c);
      if (move) {
        // Execute move
        const newBoard = board.map(row => [...row]);
        newBoard[r][c] = newBoard[selectedPos.r][selectedPos.c];
        newBoard[selectedPos.r][selectedPos.c] = 0;
        
        if (move.jump) {
          newBoard[move.jump.r][move.jump.c] = 0; // Remove jumped piece
        }

        // King promotion
        if (myPlayer === 1 && r === 0 && newBoard[r][c] === 1) newBoard[r][c] = 2;
        if (myPlayer === 3 && r === 7 && newBoard[r][c] === 3) newBoard[r][c] = 4;

        const nextTurn = turn === 'p1' ? 'p2' : 'p1';
        
        // Sync full state object
        updateGameState(JSON.stringify({ board: newBoard, turn: nextTurn }), nextTurn);
        
        setSelectedPos(null);
        setValidMoves([]);
      } else if (isMyPiece) {
        // Change selection
        setSelectedPos({ r, c });
        setValidMoves(getMoves(r, c, board, myPlayer));
      } else {
        // Deselect
        setSelectedPos(null);
        setValidMoves([]);
      }
    } else {
      if (isMyPiece) {
        setSelectedPos({ r, c });
        setValidMoves(getMoves(r, c, board, myPlayer));
      }
    }
  };

  // Orientation
  const displayBoard = isCreator ? board : [...board].reverse().map(row => [...row].reverse());

  const getRealCoords = (r, c) => {
    return isCreator ? { r, c } : { r: 7 - r, c: 7 - c };
  };

  return (
    <div className="flex flex-col items-center">
       <div className="mb-4 text-lg font-bold flex items-center gap-2">
         {isMyTurn ? <span className="text-green-400">Sua Vez</span> : 
         <span className="text-neutral-400">Vez do Oponente</span>}
      </div>

      <div className="inline-grid grid-cols-8 border-4 border-neutral-800 rounded-lg overflow-hidden shadow-2xl relative bg-neutral-900">
        {displayBoard.map((row, dR) => 
          row.map((piece, dC) => {
            const { r, c } = getRealCoords(dR, dC);
            const isDark = (dR + dC) % 2 === 1;
            const bgClass = isDark ? theme.dark : theme.light;
            const isSelected = selectedPos?.r === r && selectedPos?.c === c;
            const isValidMove = validMoves.some(m => m.toR === r && m.toC === c);
            
            return (
              <div 
                key={`${r}-${c}`}
                onClick={() => handleSquareClick(r, c)}
                className={`w-10 h-10 sm:w-14 sm:h-14 md:w-16 md:h-16 flex items-center justify-center relative cursor-pointer
                  ${bgClass} ${isSelected ? 'ring-inset ring-4 ring-yellow-400 mix-blend-luminosity' : ''}
                `}
              >
                {isValidMove && <div className="absolute w-1/3 h-1/3 bg-black/40 rounded-full" />}
                
                {piece !== 0 && (
                  <div className={`
                    w-4/5 h-4/5 rounded-full shadow-md flex items-center justify-center
                    ${(piece === 1 || piece === 2) ? 'bg-red-600 border-2 border-red-800' : 'bg-neutral-800 border-2 border-black'}
                  `}>
                    {/* Inner styling for checkers */}
                    <div className="w-2/3 h-2/3 rounded-full border border-black/20 flex items-center justify-center">
                       {(piece === 2 || piece === 4) && (
                          <span className="text-yellow-400 text-xl md:text-2xl drop-shadow-md">♔</span>
                       )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// --- Chat Component ---
function TextChat({ roomId, user }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    // Strict Path adherence: artifacts/{appId}/public/data/chat_{roomId}
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', `chat_${roomId}`);
    
    // Simple query, NO orderby, NO limits, fetch all and sort in memory
    const unsub = onSnapshot(chatRef, (snap) => {
      const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      msgs.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
      setMessages(msgs);
    }, (err) => console.error("Chat Error:", err));

    return () => unsub();
  }, [roomId, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || !user) return;
    
    const chatRef = collection(db, 'artifacts', appId, 'public', 'data', `chat_${roomId}`);
    await addDoc(chatRef, {
      text: text.trim(),
      senderId: user.uid,
      createdAt: serverTimestamp()
    });
    setText('');
  };

  return (
    <div className="bg-neutral-800 rounded-3xl flex flex-col flex-1 min-h-[300px] border border-neutral-700 shadow-xl overflow-hidden">
      <div className="bg-neutral-700/50 px-4 py-3 border-b border-neutral-600 font-bold text-sm">
        Chat da Partida
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && <p className="text-neutral-500 text-sm text-center">Nenhuma mensagem ainda.</p>}
        {messages.map(m => {
          const isMe = m.senderId === user.uid;
          return (
            <div key={m.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div className={`px-4 py-2 rounded-2xl max-w-[85%] text-sm ${isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-neutral-700 text-neutral-100 rounded-tl-none'}`}>
                {m.text}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="p-3 border-t border-neutral-700 bg-neutral-800/80 flex gap-2">
        <input 
          type="text" 
          value={text} 
          onChange={e => setText(e.target.value)}
          placeholder="Digite uma mensagem..." 
          className="flex-1 bg-neutral-900 border border-neutral-600 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
        />
        <button type="submit" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-sm font-bold transition-colors">
          Enviar
        </button>
      </form>
    </div>
  );
}

// --- Voice Chat (WebRTC) Component ---
function VoiceChat({ roomId, user }) {
  const [inCall, setInCall] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const pcRef = useRef(null);
  const unsubRef = useRef(null);

  const initWebRTC = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
      });
      pcRef.current = pc;

      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      const signalDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'webrtc_signals', roomId);

      pc.onicecandidate = async (event) => {
        if (event.candidate) {
           await setDoc(signalDocRef, {
             candidates: arrayUnion(event.candidate.toJSON())
           }, { merge: true });
        }
      };

      // Watch for signals (Offers, Answers, ICE)
      unsubRef.current = onSnapshot(signalDocRef, async (snap) => {
        const data = snap.data();
        if (!data) return;

        // If I created an offer, look for an answer
        if (pc.signalingState === 'have-local-offer' && data.answer) {
          if (!pc.currentRemoteDescription) {
             await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        }
        
        // If there's an offer and I haven't answered
        if (data.offer && pc.signalingState === 'stable' && !data.answer) {
           await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
           const answer = await pc.createAnswer();
           await pc.setLocalDescription(answer);
           await setDoc(signalDocRef, { answer: { type: answer.type, sdp: answer.sdp } }, { merge: true });
        }

        // Add ICE candidates
        if (data.candidates && pc.remoteDescription) {
           for (const c of data.candidates) {
               try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch(e) { /* ignore */ }
           }
        }
      }, (err) => console.error("WebRTC Signal error:", err));

      // Create Offer if I am the first to initialize
      const docSnap = await onSnapshot(signalDocRef, () => {}); // Get initial
      if (!pc.currentRemoteDescription) {
         // Optimistically create offer
         const offer = await pc.createOffer();
         await pc.setLocalDescription(offer);
         await setDoc(signalDocRef, { offer: { type: offer.type, sdp: offer.sdp }, startedBy: user.uid }, { merge: true });
      }

      setInCall(true);
    } catch (err) {
      console.error("Mic error:", err);
      setError("Microfone não permitido ou indisponível.");
    }
  };

  const endCall = () => {
    if (pcRef.current) pcRef.current.close();
    if (localStreamRef.current) localStreamRef.current.getTracks().forEach(t => t.stop());
    if (unsubRef.current) unsubRef.current();
    
    // Clear signaling doc
    const signalDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'webrtc_signals', roomId);
    setDoc(signalDocRef, {}); // Reset state

    setInCall(false);
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setMuted(!muted);
    }
  };

  return (
    <div className="bg-neutral-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg border border-neutral-700">
      <div className="flex items-center justify-between">
        <h3 className="font-bold flex items-center gap-2 text-sm">
          <span className="text-xl">🎙️</span> Chat de Voz
        </h3>
        {inCall && (
           <span className="flex h-3 w-3 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
        )}
      </div>
      
      {error && <p className="text-red-400 text-xs">{error}</p>}
      
      {!inCall ? (
        <button onClick={initWebRTC} className="w-full bg-emerald-600 hover:bg-emerald-500 py-2 rounded-xl text-sm font-bold transition-colors shadow">
          Conectar Voz
        </button>
      ) : (
        <div className="flex gap-2">
          <button onClick={toggleMute} className={`flex-1 py-2 rounded-xl text-sm font-bold transition-colors shadow flex items-center justify-center gap-2 ${muted ? 'bg-red-900/50 text-red-400 border border-red-800' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
            {muted ? '🔇 Mutado' : '🔊 Microfone Ativo'}
          </button>
          <button onClick={endCall} className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-xl text-sm font-bold shadow">
             Sair
          </button>
        </div>
      )}
      
      {/* Hidden audio element for remote stream */}
      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}

// --- Loading Component ---
function LoadingScreen({ message }) {
  return (
    <div className="min-h-screen bg-neutral-900 flex flex-col items-center justify-center text-white space-y-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="font-mono text-neutral-400">{message}</p>
    </div>
  );
}