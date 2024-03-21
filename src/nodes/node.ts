import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { BASE_NODE_PORT } from "../config";
import { Value, NodeState } from "../types";
import { delay } from "../utils";

export async function node(
  nodeId: number, // the ID of the node
  N: number, // total number of nodes in the network
  F: number, // number of faulty nodes in the network
  initialValue: Value, // initial value of the node
  isFaulty: boolean, // true if the node is faulty, false otherwise
  nodesAreReady: () => boolean, // used to know if all nodes are ready to receive requests
  setNodeIsReady: (index: number) => void // this should be called when the node is started and ready to receive requests
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());

  let state: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0
  };

  if (isFaulty) {
    state.x = null;
    state.decided = null;
    state.k = null;
  }

  let messagesStep1: Map<number, Value[]> = new Map();
  let messagesStep2: Map<number, Value[]> = new Map();

  node.get("/status", (req, res) => {
    if (isFaulty) {
      return res.status(500).send("faulty");
    } else {
      return res.status(200).send("live");
    }
  });

  node.get("/getState", (req, res) => {
    if (isFaulty) {
      res.status(200).json(state);
    }
    else {
      if (!state.decided) {
        res.status(200).json(state);
      }
      else {
        state.k = state.k! - 1;
        res.status(200).json(state);
        state.k = state.k! + 1;
      }
    }
  });

  node.post("/message", (req: Request, res: Response) => {
    if (!isFaulty) {
      let { x, k, step } = req.body;

      if (step === 1 && !state.decided && !state.killed) {
        if (!messagesStep1.has(k)) {
          messagesStep1.set(k, []);
        }
        messagesStep1.get(k)!.push(x);
        if (messagesStep1.get(k)!.length >= N - F) {
          const newStateValue = consensus(messagesStep1.get(k)!, state, step, N, undefined);
          if (newStateValue !== state.x) {
            state.x = newStateValue;
            sendMessageToAll(2, state, N);
          }
        }
      }
      if (step === 2 && !state.decided && !state.killed) {
        if (!messagesStep2.has(k)) {
          messagesStep2.set(k, []);
        }
        messagesStep2.get(k)!.push(x);
        if (messagesStep2.get(k)!.length >= N - F) {
          const newStateValue = consensus(messagesStep2.get(k)!, state, step, undefined, F);
          if (newStateValue !== state.x) {
            state.x = newStateValue;
            state.k! += 1;
            sendMessageToAll(1, state, N);
          }
        }
      }
    }
    res.status(200).send("success");
  });

  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(10);
    }
    if (!isFaulty) {
      state.k = 1;
      sendMessageToAll(1, state, N);
    }
    return res.status(200).send("success");
  });

  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("killed");
  });
  
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}

function consensus(messages: Value[], state: NodeState,step: number, N?:number, F?:number ) {
  let newStateValue = state.x;
  let count0 = messages.filter((el) => el === 0).length;
  let count1 = messages.filter((el) => el === 1).length;
  if (step ===1)
  {
    if (N === undefined) {
      throw new Error("Parameter N is required for step 1.");
    }
    if (2 * count0 > N) {
      newStateValue = 0;
    }
    else if (2 * count1 > N) {
      newStateValue = 1;
    }
    else {
      newStateValue = "?";
    }
  }
  else if (step ===2)
  {
    if (F === undefined) {
      throw new Error("Parameter F is required for step 2.");
    }
    if (count0 > F) {
      state.decided = true;
      newStateValue = 0;
    }
    else if (count1 > F) {
      state.decided = true;
      newStateValue = 1;
    }
    else {
      if (count0 + count1 > 0 && count0 > count1) {
        newStateValue = 0;
      }
      else if (count0 + count1 > 0 && count1 > count0) {
        newStateValue = 1;
      }
      else {
        newStateValue = Math.floor(Math.random() * 2) ? 0 : 1;
      }
    }
  }
  return newStateValue;
}

function sendMessage(destinationNodeId: number, step: number, state: NodeState) {
  fetch(`http://localhost:${BASE_NODE_PORT + destinationNodeId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ x: state.x, k: state.k, step: step }),
  });
}

function sendMessageToAll(step: number, state: NodeState, N: number) {
  for (let i = 0; i < N; i++) {
    sendMessage(i, step, state);
  }
}