// Cricket Match Engine — Domain Logic & Rules

function createInnings() {
  return {
    runs: 0,
    wickets: 0,
    balls: 0,
    overs: [],           // Array of completed & current over summaries
    currentOver: [],     // Array of ball events in this over
    batsmen: {},         // name -> { runs, balls, fours, sixes, isOut, howOut }
    bowlers: {},         // name -> { overs, maidens, runs, wickets, ballsBowled }
    striker: null,
    nonStriker: null,
    currentBowler: null,
    previousBowler: null,
    extras: { wides: 0, noBalls: 0, byes: 0, legByes: 0, penalty: 0 },
    partnerships: [],
    currentPartnership: { runs: 0, balls: 0 },
    fallOfWickets: [],
    _history: [],
    _redoStack: []
  };
}

function calculateMatchResult(match) {
  const inn1 = match.innings[0];
  const inn2 = match.innings[1];
  if (!inn1 || !inn2) return null;

  const team1Name = match.teams.team1.name;
  const team2Name = match.teams.team2.name;

  let batFirstTeam, chaseTeam, batFirstInn, chaseInn;
  if (match.battingFirst === 'team1') {
    batFirstTeam = 'team1';
    chaseTeam = 'team2';
    batFirstInn = inn1;
    chaseInn = inn2;
  } else {
    batFirstTeam = 'team2';
    chaseTeam = 'team1';
    batFirstInn = inn1;
    chaseInn = inn2;
  }

  const batFirstName = match.teams[batFirstTeam].name;
  const chaseName = match.teams[chaseTeam].name;

  if (chaseInn.runs > batFirstInn.runs) {
    const totalPlayers = match.teams[chaseTeam].players.length || 11;
    const maxWickets = match.settings?.singlePlayerMode ? totalPlayers : Math.max(1, totalPlayers - 1);
    const wicketsRemaining = Math.max(0, maxWickets - chaseInn.wickets);
    return {
      winner: chaseTeam,
      winnerName: chaseName,
      margin: `${wicketsRemaining} wicket${wicketsRemaining !== 1 ? 's' : ''}`,
      summary: `${chaseName} won by ${wicketsRemaining} wicket${wicketsRemaining !== 1 ? 's' : ''}`
    };
  } else if (batFirstInn.runs > chaseInn.runs) {
    const runDiff = batFirstInn.runs - chaseInn.runs;
    return {
      winner: batFirstTeam,
      winnerName: batFirstName,
      margin: `${runDiff} run${runDiff !== 1 ? 's' : ''}`,
      summary: `${batFirstName} won by ${runDiff} run${runDiff !== 1 ? 's' : ''}`
    };
  } else {
    return {
      winner: 'tie',
      winnerName: 'Match Tied',
      margin: 'Scores Level',
      summary: 'Match Tied — Scores Level'
    };
  }
}

module.exports = {
  createInnings,
  calculateMatchResult
};
