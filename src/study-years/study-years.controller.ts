import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CreateStudyYearDto } from './dto/create-study-year.dto';
import { UpdateStudyYearDto } from './dto/update-study-year.dto';
import { StudyYearsService } from './study-years.service';

@ApiTags('study-years')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('study-years')
export class StudyYearsController {
  constructor(private readonly studyYearsService: StudyYearsService) {}

  @Get()
  findAll() {
    return this.studyYearsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateStudyYearDto) {
    return this.studyYearsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.studyYearsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudyYearDto,
  ) {
    return this.studyYearsService.update(id, dto);
  }
}
