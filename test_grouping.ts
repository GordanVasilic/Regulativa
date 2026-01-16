
import { groupingService } from './apps/api/src/services/grouping.service';

const title1 = "Zakon o policiji i unutrašnjim poslovima";
const title2 = "Zakon o izmjeni i dopunama Zakona o policiji i unutrašnjim poslovima";

console.log(`Title 1: "${title1}"`);
console.log(`Root 1 : "${groupingService.getRootTitle(title1)}"`);

console.log(`Title 2: "${title2}"`);
console.log(`Root 2 : "${groupingService.getRootTitle(title2)}"`);

const groupName = "Zakon o policiji i unutrašnjim poslovima"; // Group 118 name (likely)
console.log(`Group Name: "${groupName}"`);
console.log(`Group Root: "${groupingService.getRootTitle(groupName)}"`);
