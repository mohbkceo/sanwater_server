function randomSyllable() {
  const consonants = ['b', 'c', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'z'];
  const vowels = ['a', 'e', 'i', 'o', 'u'];

  const syllable = 
    consonants[Math.floor(Math.random() * consonants.length)] +
    vowels[Math.floor(Math.random() * vowels.length)] +
    (Math.random() > 0.6 ? consonants[Math.floor(Math.random() * consonants.length)] : '');

  return syllable;
}

function generateUniqueName() {
  const parts = [];
  const numberOfSyllables = Math.floor(Math.random() * 2) + 2; // 2–3 syllables

  for (let i = 0; i < numberOfSyllables; i++) {
    parts.push(randomSyllable());
  }

  return parts.join('');
}

function generateSerialNumber(prefix = 'logix') {
  const nameCore = generateUniqueName();
  const number = Math.floor(100 + Math.random() * 900); // 3-digit number
  return `${prefix}_${nameCore}${number}`;
}

module.exports = generateSerialNumber;

  