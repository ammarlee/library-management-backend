import { Module } from '@nestjs/common';
import { StudyYearsController } from './study-years.controller';
import { StudyYearsService } from './study-years.service';

@Module({
  controllers: [StudyYearsController],
  providers: [StudyYearsService],
  exports: [StudyYearsService],
})
export class StudyYearsModule {}
